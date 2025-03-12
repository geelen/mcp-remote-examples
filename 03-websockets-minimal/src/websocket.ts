import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { JSONRPCMessage, JSONRPCMessageSchema } from '@modelcontextprotocol/sdk/types.js';

const SUBPROTOCOL = 'mcp';

/**
 * Server transport for WebSockets: this will send messages over a WebSocket connection and receive messages from HTTP POST requests.
 */
export class WSServerTransport implements Transport {
	private _server?: WebSocket;
	private _client?: WebSocket;
	sessionId: string;
	connected: boolean = false;

	onclose?: () => void;
	onerror?: (error: Error) => void;
	onmessage?: (message: JSONRPCMessage) => void;

	constructor() {
		this.sessionId = crypto.randomUUID();
	}

	async start(): Promise<void> {
		if (this._server) {
			throw new Error('WebSocket already started');
		}

		const webSocketPair = new WebSocketPair();
		const [client, server] = Object.values(webSocketPair);

		server.addEventListener('message', async (event) => {
			let message: JSONRPCMessage;
			try {
				// Ensure event.data is a string
				const data = typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data);
				message = JSONRPCMessageSchema.parse(JSON.parse(data));
			} catch (error) {
				this.onerror?.(error as Error);
				return;
			}

			console.log('received message', message);
			this.onmessage?.(message);
		});

		server.addEventListener('close', () => {
			this.connected = false;
			this.onclose?.();
		});

		server.addEventListener('error', (event) => {
			this.onerror?.(new Error(event.message));
		});

		this._server = server;
		this._client = client;
		// Calling `accept()` tells the runtime that this WebSocket is to begin terminating
		// request within the Durable Object. It has the effect of "accepting" the connection,
		// and allowing the WebSocket to send and receive messages.
		server.accept();
		this.connected = true;
	}

	async send(message: JSONRPCMessage): Promise<void> {
		if (!this._server) {
			throw new Error('Not connected');
		}

		console.log('sending message', message);
		this._server.send(JSON.stringify(message));
	}

	async close(): Promise<void> {
		this._server?.close();
	}

	get upgradeResponse(): Response {
		return new Response(null, {
			status: 101,
			webSocket: this._client,
			headers: { 'Sec-WebSocket-Protocol': SUBPROTOCOL },
		});
	}
}
