import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { DurableObject } from "cloudflare:workers";
import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { JSONRPCMessageSchema } from "@modelcontextprotocol/sdk/types.js";
import { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";

const SUBPROTOCOL = "mcp";

export abstract class MCPEntrypoint extends DurableObject implements Transport {
  server: McpServer;
  webSocketClient: WebSocket;
  webSocketServer: WebSocket;

  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.server = this.getServer();
    const webSocketPair = new WebSocketPair();
    this.webSocketClient = webSocketPair[0];
    this.webSocketServer = webSocketPair[1];
  }

  abstract getServer(): McpServer;

  async start(): Promise<void> {
    this.ctx.acceptWebSocket(this.webSocketServer);
  }

  async send(message: JSONRPCMessage): Promise<void> {
    this.webSocketServer.send(JSON.stringify(message));
  }

  async close(): Promise<void> {
    this.webSocketServer.close();
  }

  override async fetch(request: Request) {
    if (request.headers.get("Upgrade") === "websocket") {
      await this.server.connect(this);

      return new Response(null, {
        status: 101,
        webSocket: this.webSocketClient,
        headers: { "Sec-WebSocket-Protocol": SUBPROTOCOL },
      });
    }

    return new Response("Expected WebSocket connection", { status: 400 });
  }

  async webSocketMessage(ws: WebSocket, event: ArrayBuffer | string) {
    let message: JSONRPCMessage;
    try {
      // Ensure event is a string
      const data =
        typeof event === "string" ? event : new TextDecoder().decode(event);
      message = JSONRPCMessageSchema.parse(JSON.parse(data));
    } catch (error) {
      this.onerror?.(error as Error);
      return;
    }

    console.log("received message", message);
    this.onmessage?.(message);
  }

  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    this.onerror?.(error as Error);
  }

  async webSocketClose(
    ws: WebSocket,
    code: number,
    reason: string,
    wasClean: boolean
  ): Promise<void> {
    this.onclose?.();
  }
}
