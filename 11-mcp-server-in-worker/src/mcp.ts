import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Agent, WSMessage, Connection } from "agents";
import type {
  JSONRPCError,
  JSONRPCMessage,
  JSONRPCNotification,
  JSONRPCRequest,
  JSONRPCResponse,
} from "@modelcontextprotocol/sdk/types.js";
import type {
  Transport,
  TransportSendOptions,
} from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  InitializeRequestSchema,
  isJSONRPCError,
  isJSONRPCNotification,
  isJSONRPCRequest,
  isJSONRPCResponse,
  JSONRPCErrorSchema,
  JSONRPCMessageSchema,
  JSONRPCNotificationSchema,
  JSONRPCRequestSchema,
  JSONRPCResponseSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { CORSOptions, handleCORS } from "./cors.js";

const MAXIMUM_MESSAGE_SIZE_BYTES = 4 * 1024 * 1024; // 4MB

type MaybePromise<T> = T | Promise<T>;

// This will need to keep a copy of all the messages sent on this session
// so that it can send them to the streamable transport when requested.
// It will also need to be able to open a WebSocket connection to support
// GET requests
export class McpSession<Env = unknown, State = unknown> extends Agent<
  Env,
  State
> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
  }

  async setInitialized(sessionId: string) {
    await this.ctx.storage.put("sessionId", sessionId);
    await this.ctx.storage.put("initialized", true);
  }

  async isInitialized() {
    return (await this.ctx.storage.get("initialized")) === true;
  }

  async getSessionId(): Promise<string> {
    const sessionId = await this.ctx.storage.get("sessionId");
    if (!sessionId) {
      throw new Error("Session ID not found");
    }
    return sessionId as string;
  }

  async fetch(request: Request): Promise<Response> {
    // Both Streamable and SSE can only have one long-lived GET request
    // If we get an upgrade while already connected, we should error
    const websockets = this.ctx.getWebSockets();
    if (websockets.length > 0) {
      return new Response("Websocket already connected", { status: 400 });
    }

    return super.fetch(request);
  }

  getWebSocket() {
    const websockets = this.ctx.getWebSockets();
    if (websockets.length === 0) {
      return null;
    }
    return websockets[0];
  }

  async onSSEMessage(message: JSONRPCMessage): Promise<Error | void> {
    // if there is a connection listening, proxy the message over that connection
    const websocket = this.getWebSocket();
    if (!websocket) {
      return new Error("No websocket connection found");
    }

    websocket.send(JSON.stringify(message));
  }

  async onStreamableHttpMessage(
    sessionId: string,
    request: Request
  ): Promise<Error | null> {
    // if there is a connection listening, we might need to proxy the message
    // over that connection
    const websocket = this.getWebSocket();

    return null;
  }
}

class McpSSESessionTransport implements Transport {
  private readonly encoder = new TextEncoder();
  private readonly readable: ReadableStream;
  private readonly writer: WritableStreamDefaultWriter;

  #started = false;

  // Transport requirements
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  constructor(
    readonly sessionId: string,
    private readonly session: DurableObjectStub<McpSession>
  ) {
    const { readable, writable } = new TransformStream();
    this.readable = readable;
    this.writer = writable.getWriter();
  }

  async start() {
    if (this.#started) {
      throw new Error("Transport already started");
    }
    this.#started = true;
  }

  async send(message: JSONRPCMessage, options?: TransportSendOptions) {
    if (!this.#started) {
      throw new Error("Transport not started");
    }

    // write the message on the SSE stream
    const messageText = `event: message\ndata: ${JSON.stringify(message)}\n\n`;
    await this.writer.write(this.encoder.encode(messageText));
  }

  async close() {
    // Similar to start, the only thing to do is to pass the event on to the server
    this.onclose?.();
    await this.writer.close();
  }

  async getSSEStream(
    postEndpoint: URL,
    corsOptions?: CORSOptions
  ): Promise<Response> {
    const self = this;

    // write the initialization message
    const endpointMessage = `event: endpoint\ndata: ${postEndpoint}\n\n`;
    this.writer.write(this.encoder.encode(endpointMessage));

    // get a websocket connection to the session
    const response = await this.session.fetch(
      new Request(postEndpoint, {
        headers: {
          Upgrade: "websocket",
          "x-partykit-room": this.sessionId,
        },
      })
    );
    const ws = response.webSocket;
    if (!ws) {
      console.error("Failed to establish WebSocket connection");
      await this.writer.close();
      return new Response("Failed to establish WebSocket connection", {
        status: 500,
      });
    }
    ws.accept();

    // Handle WebSocket errors
    ws.addEventListener("error", (error) => {
      async function onError(error: Event) {
        try {
          await self.writer.close();
        } catch (e) {
          // Ignore errors when closing
        }
      }
      onError(error).catch(console.error);
    });

    // Handle WebSocket closure
    ws.addEventListener("close", () => {
      async function onClose() {
        try {
          await self.writer.close();
        } catch (error) {
          console.error("Error closing SSE connection:", error);
        }
      }
      onClose().catch(console.error);
    });

    // Handle messages from the Session Durable Object
    ws.addEventListener("message", (event) => {
      async function onMessage(event: MessageEvent) {
        try {
          // Convert ArrayBuffer to string if needed
          const data =
            event.data instanceof ArrayBuffer
              ? new TextDecoder().decode(event.data)
              : event.data;

          const message = JSON.parse(data);

          // validate that the message is a valid JSONRPC message
          const result = JSONRPCMessageSchema.safeParse(message);
          if (!result.success) {
            // The message was not a valid JSONRPC message, so we will drop it
            // PartyKit will broadcast state change messages to all connected clients
            // and we need to filter those out so they are not passed to MCP clients
            return;
          }

          // pass the message to the transport so the McpServer can process it
          self.onmessage?.(result.data);
        } catch (error) {
          console.error("Error forwarding message to SSE:", error);
        }
      }
      onMessage(event).catch(console.error);
    });

    return new Response(this.readable, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": corsOptions?.origin || "*",
      },
      status: 200,
    });
  }

  async onMcpMessage(
    message: JSONRPCMessage,
    corsOptions?: CORSOptions
  ): Promise<Response> {
    await this.session.onSSEMessage(message);

    return new Response("Accepted", {
      status: 202,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": corsOptions?.origin || "*",
      },
    });
  }
}

class McpStreamableSessionTransport implements Transport {
  private readonly encoder = new TextEncoder();
  private readonly readable: ReadableStream;
  private readonly writer: WritableStreamDefaultWriter;

  #started = false;
  #requestIds: Set<string | number> = new Set();

  // Tranport requirements
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  constructor(
    readonly sessionId: string,
    private readonly session: DurableObjectStub<McpSession>
  ) {
    // Create a Transform Stream for the SSE response
    const { readable, writable } = new TransformStream();
    this.readable = readable;
    this.writer = writable.getWriter();
  }

  async start() {
    // There's nothing to initialize.
    if (this.#started) {
      throw new Error("Transport already started");
    }
    this.#started = true;
  }

  async writeMessageToStream(message: JSONRPCMessage) {
    const messageText = `event: message\ndata: ${JSON.stringify(message)}\n\n`;
    await this.writer.write(this.encoder.encode(messageText));
  }

  async send(message: JSONRPCMessage, options?: TransportSendOptions) {
    if (!this.#started) {
      throw new Error("Transport not started");
    }

    if (isJSONRPCResponse(message) || isJSONRPCError(message)) {
      this.#requestIds.delete(message.id.toString());
      await this.writeMessageToStream(message);

      // send a copy to the session
      // TODO
    } else if (isJSONRPCRequest(message)) {
      // send to the session
      // TODO
    } else if (isJSONRPCNotification(message)) {
      // if we have a relatedRequestId, send to the stream
      if (
        options?.relatedRequestId &&
        this.#requestIds.has(options.relatedRequestId)
      ) {
        await this.writeMessageToStream(message);
      }
      // send to the session
      // TODO
    }

    if (this.#requestIds.size === 0) {
      await this.writer.close();
    }
  }

  async close() {
    // Similar to start, the only thing to do is to pass the event on to the server
    this.onclose?.();
  }

  // This abstracts away the details of the SSE response from the worker.
  // We will return an SSE Stream, but we could optionally wait until all
  // of the messages have been sent and then return a single JSON response
  async processMessages(
    messages: JSONRPCMessage[],
    corsOptions?: CORSOptions
  ): Promise<Response> {
    // If there are no requests, we send the messages to the agent and acknowledge the request with a 202
    // since we don't expect any responses back through this connection
    const hasOnlyNotificationsOrResponses = messages.every(
      (msg) => isJSONRPCNotification(msg) || isJSONRPCResponse(msg)
    );

    for (const message of messages) {
      // Track the ids of all incoming requests so we can shut down the connection
      // once we've processed them all
      // We can ignore notifications, responses, and errors
      if (isJSONRPCRequest(message)) {
        this.#requestIds.add(message.id);
      }
      this.onmessage?.(message);
    }

    // If there are no requests to process, we can acknowledge the request with a 202
    // and be done
    if (hasOnlyNotificationsOrResponses) {
      return new Response(null, { status: 202 });
    }

    // Otherwise, we need to return the SSE stream which we'll close
    // once all the requests have been processed and responded to
    return new Response(this.readable, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "mcp-session-id": this.sessionId,
        "Access-Control-Allow-Origin": corsOptions?.origin || "*",
      },
      status: 200,
    });
  }
}

export class Mcp {
  static serve<Env>(
    path: string,
    getMcpServer: (
      session: DurableObjectStub<McpSession>
    ) => MaybePromise<McpServer>,
    {
      binding = "MCP_OBJECT",
      corsOptions,
    }: { binding?: string; corsOptions?: CORSOptions } = {}
  ) {
    let pathname = path;
    if (path === "/") {
      pathname = "/*";
    }
    const basePattern = new URLPattern({ pathname });

    return {
      async fetch(request: Request, env: Env, ctx: ExecutionContext) {
        // Handle CORS preflight
        const corsResponse = handleCORS(request, corsOptions);
        if (corsResponse) {
          return corsResponse;
        }

        const url = new URL(request.url);
        const bindingValue = env[binding as keyof typeof env] as unknown;

        // Ensure we have a binding of some sort
        if (bindingValue == null || typeof bindingValue !== "object") {
          console.error(
            `Could not find McpAgent binding for ${binding}. Did you update your wrangler configuration?`
          );
          return new Response("Invalid binding", { status: 500 });
        }

        // Ensure that the biding is to a DurableObject
        if (bindingValue.toString() !== "[object DurableObjectNamespace]") {
          return new Response("Invalid binding", { status: 500 });
        }

        const namespace = bindingValue as DurableObjectNamespace<McpSession>;
        if (request.method === "POST" && basePattern.test(url)) {
          // validate the Accept header
          const acceptHeader = request.headers.get("accept");
          // The client MUST include an Accept header, listing both application/json and text/event-stream as supported content types.
          if (
            !acceptHeader?.includes("application/json") ||
            !acceptHeader.includes("text/event-stream")
          ) {
            const body = JSON.stringify({
              jsonrpc: "2.0",
              error: {
                code: -32000,
                message:
                  "Not Acceptable: Client must accept both application/json and text/event-stream",
              },
              id: null,
            });
            return new Response(body, { status: 406 });
          }

          const ct = request.headers.get("content-type");
          if (!ct || !ct.includes("application/json")) {
            const body = JSON.stringify({
              jsonrpc: "2.0",
              error: {
                code: -32000,
                message:
                  "Unsupported Media Type: Content-Type must be application/json",
              },
              id: null,
            });
            return new Response(body, { status: 415 });
          }

          // Check content length against maximum allowed size
          const contentLength = Number.parseInt(
            request.headers.get("content-length") ?? "0",
            10
          );
          if (contentLength > MAXIMUM_MESSAGE_SIZE_BYTES) {
            const body = JSON.stringify({
              jsonrpc: "2.0",
              error: {
                code: -32000,
                message: `Request body too large. Maximum size is ${MAXIMUM_MESSAGE_SIZE_BYTES} bytes`,
              },
              id: null,
            });
            return new Response(body, { status: 413 });
          }

          let sessionId = request.headers.get("mcp-session-id");
          let rawMessage: unknown;

          try {
            rawMessage = await request.json();
          } catch (error) {
            const body = JSON.stringify({
              jsonrpc: "2.0",
              error: {
                code: -32700,
                message: "Parse error: Invalid JSON",
              },
              id: null,
            });
            return new Response(body, { status: 400 });
          }

          // Make sure the message is an array to simplify logic
          let arrayMessage: unknown[];
          if (Array.isArray(rawMessage)) {
            arrayMessage = rawMessage;
          } else {
            arrayMessage = [rawMessage];
          }

          let messages: JSONRPCMessage[] = [];

          // Try to parse each message as JSON RPC. Fail if any message is invalid
          for (const msg of arrayMessage) {
            if (!JSONRPCMessageSchema.safeParse(msg).success) {
              const body = JSON.stringify({
                jsonrpc: "2.0",
                error: {
                  code: -32700,
                  message: "Parse error: Invalid JSON-RPC message",
                },
                id: null,
              });
              return new Response(body, { status: 400 });
            }
          }

          messages = arrayMessage.map((msg) => JSONRPCMessageSchema.parse(msg));

          // Before we pass the messages to the agent, there's another error condition we need to enforce
          // Check if this is an initialization request
          // https://spec.modelcontextprotocol.io/specification/2025-03-26/basic/lifecycle/
          const isInitializationRequest = messages.some(
            (msg) => InitializeRequestSchema.safeParse(msg).success
          );

          if (isInitializationRequest && sessionId) {
            const body = JSON.stringify({
              jsonrpc: "2.0",
              error: {
                code: -32600,
                message:
                  "Invalid Request: Initialization requests must not include a sessionId",
              },
              id: null,
            });
            return new Response(body, { status: 400 });
          }

          // The initialization request must be the only request in the batch
          if (isInitializationRequest && messages.length > 1) {
            const body = JSON.stringify({
              jsonrpc: "2.0",
              error: {
                code: -32600,
                message:
                  "Invalid Request: Only one initialization request is allowed",
              },
              id: null,
            });
            return new Response(body, { status: 400 });
          }

          // If an Mcp-Session-Id is returned by the server during initialization,
          // clients using the Streamable HTTP transport MUST include it
          // in the Mcp-Session-Id header on all of their subsequent HTTP requests.
          if (!isInitializationRequest && !sessionId) {
            const body = JSON.stringify({
              jsonrpc: "2.0",
              error: {
                code: -32000,
                message: "Bad Request: Mcp-Session-Id header is required",
              },
              id: null,
            });
            return new Response(body, { status: 400 });
          }

          // If we don't have a sessionId, we are serving an initialization request
          // and need to generate a new sessionId
          sessionId = sessionId ?? namespace.newUniqueId().toString();

          // fetch the agent DO
          const id = namespace.idFromName(`streamable-http:${sessionId}`);
          const doStub = namespace.get(id);
          const isInitialized = await doStub.isInitialized();

          if (isInitializationRequest) {
            await doStub.setInitialized(sessionId);
          } else if (!isInitialized) {
            // if we have gotten here, then a session id that was never initialized
            // was provided
            const body = JSON.stringify({
              jsonrpc: "2.0",
              error: {
                code: -32001,
                message: "Session not found",
              },
              id: null,
            });
            return new Response(body, { status: 404 });
          }

          // We've evaluated all the error conditions!

          // We need an McpServer
          const mcpServer = await getMcpServer(doStub);

          // Establish a transport for the session
          const transport = new McpStreamableSessionTransport(
            sessionId,
            doStub
          );

          // Connect the transport to the server
          await mcpServer.connect(transport);

          // Pass all of the messages to the transport
          // and let it handle the response
          return await transport.processMessages(messages, corsOptions);
        }

        // We don't yet support GET or DELETE requests
        const body = JSON.stringify({
          jsonrpc: "2.0",
          error: {
            code: -32000,
            message: "Method not allowed",
          },
          id: null,
        });
        return new Response(body, { status: 405 });
      },
    };
  }

  static serveSSE<Env>(
    path: string,
    getMcpServer: (
      session: DurableObjectStub<McpSession>
    ) => MaybePromise<McpServer>,
    {
      binding = "MCP_OBJECT",
      corsOptions,
    }: {
      binding?: string;
      corsOptions?: CORSOptions;
    } = {}
  ) {
    let pathname = path;
    if (path === "/") {
      pathname = "/*";
    }
    const basePattern = new URLPattern({ pathname });
    const messagePattern = new URLPattern({ pathname: `${pathname}/message` });

    return {
      async fetch(
        request: Request,
        env: Env,
        ctx: ExecutionContext
      ): Promise<Response> {
        // Handle CORS preflight
        const corsResponse = handleCORS(request, corsOptions);
        if (corsResponse) return corsResponse;

        const url = new URL(request.url);
        const bindingValue = env[binding as keyof typeof env] as unknown;

        // Ensure we have a binding of some sort
        if (bindingValue == null || typeof bindingValue !== "object") {
          console.error(
            `Could not find McpAgent binding for ${binding}. Did you update your wrangler configuration?`
          );
          return new Response("Invalid binding", { status: 500 });
        }

        // Ensure that the biding is to a DurableObject
        if (bindingValue.toString() !== "[object DurableObjectNamespace]") {
          return new Response("Invalid binding", { status: 500 });
        }

        const namespace = bindingValue as DurableObjectNamespace<McpSession>;

        // Handle initial SSE connection
        if (request.method === "GET" && basePattern.test(url)) {
          // Use a session ID if one is passed in, or create a unique
          // session ID for this connection
          const sessionId =
            url.searchParams.get("sessionId") ||
            namespace.newUniqueId().toString();

          // Get the session DO
          const id = namespace.idFromName(`sse:${sessionId}`);
          const doStub = namespace.get(id);

          // We need an McpServer
          const mcpServer = await getMcpServer(doStub);

          // Establish a transport for the session
          const transport = new McpSSESessionTransport(sessionId, doStub);

          // Connect the transport to the server
          await mcpServer.connect(transport);

          // Generate the endpoint url so we can tell the client where
          // to send messages. If the path is "/sse", then the endpoint
          // will be "/sse/message"
          const endpointUrl = new URL(request.url);
          endpointUrl.pathname = encodeURI(`${pathname}/message`);
          endpointUrl.searchParams.set("sessionId", sessionId);
          const relativeUrlWithSession = new URL(
            endpointUrl.origin +
              endpointUrl.pathname +
              endpointUrl.search +
              endpointUrl.hash
          );

          return transport.getSSEStream(relativeUrlWithSession, corsOptions);
        }

        // Handle incoming MCP messages. These will be passed to McpAgent
        // but the response will be sent back via the open SSE connection
        // so we only need to return a 202 Accepted response for success
        if (request.method === "POST" && messagePattern.test(url)) {
          const sessionId = url.searchParams.get("sessionId");
          if (!sessionId) {
            return new Response(
              `Missing sessionId. Expected POST to ${pathname} to initiate new one`,
              { status: 400 }
            );
          }

          const contentType = request.headers.get("content-type") || "";
          if (!contentType.includes("application/json")) {
            return new Response(`Unsupported content-type: ${contentType}`, {
              status: 400,
            });
          }

          // check if the request body is too large
          const contentLength = Number.parseInt(
            request.headers.get("content-length") || "0",
            10
          );
          if (contentLength > MAXIMUM_MESSAGE_SIZE_BYTES) {
            return new Response(
              `Request body too large: ${contentLength} bytes`,
              {
                status: 400,
              }
            );
          }

          // Get the Durable Object
          const id = namespace.idFromName(`sse:${sessionId}`);
          const doStub = namespace.get(id);

          // Establish a transport for the session
          const transport = new McpSSESessionTransport(sessionId, doStub);

          // Make sure we have a valid JSON-RPC message
          const message = await request.json();
          const parsed = JSONRPCMessageSchema.safeParse(message);
          if (!parsed.success) {
            return new Response("Invalid JSON-RPC message", {
              status: 400,
              headers: {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
                Connection: "keep-alive",
                "Access-Control-Allow-Origin": corsOptions?.origin || "*",
              },
            });
          }

          // Forward the request to the transport
          return await transport.onMcpMessage(parsed.data, corsOptions);
        }

        return new Response("Not Found", { status: 404 });
      },
    };
  }
}
