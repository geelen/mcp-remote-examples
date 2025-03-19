import { DurableObject, WorkerEntrypoint } from 'cloudflare:workers';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEEdgeTransport } from './sseEdge';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { mcpProxy } from './mcpProxy';
import { JSONRPCMessage, JSONRPCMessageSchema } from '@modelcontextprotocol/sdk/types.js';

const MAXIMUM_MESSAGE_SIZE = 4 * 1024 * 1024; // 4MB

export abstract class DurableMCP<
  T extends Record<string, any> = Record<string, any>,
  Env = unknown
> extends DurableObject<Env> {
  abstract server: McpServer;
  webSocketServer: WebSocket;

  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  props!: T;
  initRun = false;
  closed = false;
  started = false;

  abstract init(): Promise<void>;

  async _init(props: T) {
    this.props = props;

    const webSocketPair = new WebSocketPair();
    const webSocketClient = webSocketPair[0];
    this.webSocketServer = webSocketPair[1];

    if (!this.initRun) {
      this.initRun = true;
      await this.init();
    }

    await this.server.connect(this);
    return new Response(null, {
      status: 101,
      webSocket: webSocketClient,
    });
  }

  async start(): Promise<void> {
    this.ctx.acceptWebSocket(this.webSocketServer);
    this.started = true;
  }

  async send(message: JSONRPCMessage): Promise<void> {
    console.log('sending message', message);
    this.webSocketServer.send(JSON.stringify(message));
  }

  async close(): Promise<void> {
    this.webSocketServer.close();
    this.closed = true;
  }

  // We don't return the client, so this should never happen
  async webSocketMessage(ws: WebSocket, event: ArrayBuffer | string) {
    let message: JSONRPCMessage;
    try {
      // Ensure event is a string
      const data = typeof event === 'string' ? event : new TextDecoder().decode(event);
      message = JSONRPCMessageSchema.parse(JSON.parse(data));
    } catch (error) {
      this.onerror?.(error as Error);
      return;
    }

    this.onmessage?.(message);
  }

  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    this.onerror?.(error as Error);
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): Promise<void> {
    this.onclose?.();
  }

  /**
   * Handles incoming Requests
   */
  async handlePostMessage(req: Request): Promise<Response> {
    console.log('handlePostMessage', req);
    if (this.closed || !this.started) {
      const message = 'SSE connection not established';
      return new Response(message, { status: 500 });
    }

    try {
      const contentType = req.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        throw new Error(`Unsupported content-type: ${contentType}`);
      }

      // Check if the request body is too large
      const contentLength = parseInt(req.headers.get('content-length') || '0', 10);
      if (contentLength > MAXIMUM_MESSAGE_SIZE) {
        throw new Error(`Request body too large: ${contentLength} bytes`);
      }

      // Clone the request before reading the body to avoid stream issues
      const body = await req.json();
      await this.handleMessage(body);
      return new Response('Accepted', { status: 202 });
    } catch (error) {
      this.onerror?.(error as Error);
      return new Response(String(error), { status: 400 });
    }
  }

  async handleMessage(message: unknown): Promise<void> {
    let parsedMessage: JSONRPCMessage;
    try {
      parsedMessage = JSONRPCMessageSchema.parse(message);
    } catch (error) {
      this.onerror?.(error as Error);
      throw error;
    }

    this.onmessage?.(parsedMessage);
  }

  static mount(
    path: string,
    {
      binding = 'MCP_OBJECT',
      corsOptions,
    }: {
      binding?: string;
      corsOptions?: Parameters<typeof cors>[0];
    } = {}
  ) {
    const router = new Hono<{
      Bindings: { [binding]: DurableObjectNamespace<DurableMCP> };
    }>();

    router.get(path, cors(corsOptions), async (c) => {
      const namespace = c.env[binding];
      const id = namespace.newUniqueId();
      const object = namespace.get(id);

      // @ts-ignore
      console.log({ props: c.executionCtx.props });
      // @ts-ignore
      let res = await object._init(c.executionCtx.props);

      console.log({ res });
      // webSocketClient.addEventListener('message', (event) => {
      //   console.log('message', event);
      // });

      // webSocketClient.addEventListener('error', (event) => {
      //   console.log('error', event);
      // });

      // webSocketClient.addEventListener('close', () => {
      //   console.log('close');
      // });

      const transport = new SSEEdgeTransport('/sse/message', id.toString());
      await transport.start();

      mcpProxy({
        transportToClient: transport,
        transportToServer: object,
      });

      return transport.sseResponse;
    });

    router.post('/sse/message', cors(corsOptions), async (c) => {
      const namespace = c.env[binding];
      const sessionId = c.req.query('sessionId');
      if (!sessionId) {
        return new Response('Missing sessionId. Expected POST to /sse to initiate new one', { status: 400 });
      }
      const object = namespace.get(namespace.idFromString(sessionId));
      return (await object.handlePostMessage(c.req.raw)) as unknown as Response;
    });

    return router;
  }
}
