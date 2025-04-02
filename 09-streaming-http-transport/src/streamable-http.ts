// This should be available in workers. Not sure why it's erroring here:
// https://developers.cloudflare.com/workers/runtime-apis/nodejs/crypto/
// @ts-ignore
import { randomUUID } from 'node:crypto';
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { JSONRPCMessage, JSONRPCMessageSchema } from '@modelcontextprotocol/sdk/types.js';
import getRawBody from 'raw-body';
import contentType from 'content-type';

const MAXIMUM_MESSAGE_SIZE = '4mb';

interface StreamConnection {
	writer: WritableStreamDefaultWriter<any>;
	encoder: TextEncoder;
	lastEventId?: string;
	messages: Array<{
		id: string;
		message: JSONRPCMessage;
	}>;
	// mark this connection as a response to a specific request
	requestId?: string | null;
}

/**
 * Configuration options for StreamableHTTPServerTransport
 */
export interface StreamableHTTPServerTransportOptions {
	/**
	 * Whether to enable session management through mcp-session-id headers
	 * When set to false, the transport operates in stateless mode without session validation
	 * @default true
	 */
	enableSessionManagement?: boolean;
}

/**
 * Server transport for Streamable HTTP: this implements the MCP Streamable HTTP transport specification.
 * It supports both SSE streaming and direct HTTP responses, with session management and message resumability.
 *
 * Usage example:
 *
 * ```typescript
 * // Stateful mode (default) - with session management
 * const statefulTransport = new StreamableHTTPServerTransport("/mcp");
 *
 * // Stateless mode - without session management
 * const statelessTransport = new StreamableHTTPServerTransport("/mcp", {
 *   enableSessionManagement: false
 * });
 *
 * // Using with pre-parsed request body
 * app.post('/mcp', (req, res) => {
 *   transport.handleRequest(req, res, req.body);
 * });
 * ```
 *
 * In stateful mode:
 * - Session ID is generated and included in response headers
 * - Session ID is always included in initialization responses
 * - Requests with invalid session IDs are rejected with 404 Not Found
 * - Non-initialization requests without a session ID are rejected with 400 Bad Request
 * - State is maintained in-memory (connections, message history)
 *
 * In stateless mode:
 * - Session ID is only included in initialization responses
 * - No session validation is performed
 */
export class StreamableHTTPServerTransport implements Transport {
	private _connections: Map<string, StreamConnection> = new Map();
	private _sessionId: string;
	private _messageHistory: Map<
		string,
		{
			message: JSONRPCMessage;
			connectionId?: string; // record which connection the message should be sent to
		}
	> = new Map();
	private _started: boolean = false;
	private _requestConnections: Map<string, string> = new Map(); // request ID to connection ID mapping
	private _enableSessionManagement: boolean;

	onclose?: () => void;
	onerror?: (error: Error) => void;
	onmessage?: (message: JSONRPCMessage) => void;

	constructor(options?: StreamableHTTPServerTransportOptions) {
		this._sessionId = randomUUID();
		this._enableSessionManagement = options?.enableSessionManagement !== false;
	}

	/**
	 * Starts the transport. This is required by the Transport interface but is a no-op
	 * for the Streamable HTTP transport as connections are managed per-request.
	 */
	async start(): Promise<void> {
		if (this._started) {
			throw new Error('Transport already started');
		}
		this._started = true;
	}

	/**
	 * Handles an incoming HTTP request, whether GET or POST
	 */
	async handleRequest(req: Request, parsedBody?: unknown): Promise<Response> {
		// Only validate session ID for non-initialization requests when session management is enabled
		if (this._enableSessionManagement) {
			const sessionId = req.headers.get('mcp-session-id');

			// Check if this might be an initialization request
			const isInitializationRequest = req.method === 'POST' && req.headers.get('content-type')?.includes('application/json');

			if (isInitializationRequest) {
				// For POST requests with JSON content, we need to check if it's an initialization request
				// This will be done in handlePostRequest, as we need to parse the body
				// Continue processing normally
			} else if (!sessionId) {
				// Non-initialization requests without a session ID should return 400 Bad Request
				const body = JSON.stringify({
					jsonrpc: '2.0',
					error: {
						code: -32000,
						message: 'Bad Request: Mcp-Session-Id header is required',
					},
					id: null,
				});
				return new Response(body, { status: 400 });
			} else if ((Array.isArray(sessionId) ? sessionId[0] : sessionId) !== this._sessionId) {
				// Reject requests with invalid session ID with 404 Not Found
				const body = JSON.stringify({
					jsonrpc: '2.0',
					error: {
						code: -32001,
						message: 'Session not found',
					},
					id: null,
				});
				return new Response(body, { status: 404 });
			}
		}

		if (req.method === 'GET') {
			return await this.handleGetRequest(req);
		} else if (req.method === 'POST') {
			return await this.handlePostRequest(req, parsedBody);
		} else if (req.method === 'DELETE') {
			return await this.handleDeleteRequest(req);
		} else {
			const body = JSON.stringify({
				jsonrpc: '2.0',
				error: {
					code: -32000,
					message: 'Method not allowed',
				},
				id: null,
			});
			return new Response(body, { status: 405 });
		}
	}

	/**
	 * Handles GET requests to establish SSE connections
	 */
	private async handleGetRequest(req: Request): Promise<Response> {
		// validate the Accept header
		const acceptHeader = req.headers.get('accept');
		if (!acceptHeader || !acceptHeader.includes('text/event-stream')) {
			const body = JSON.stringify({
				jsonrpc: '2.0',
				error: {
					code: -32000,
					message: 'Not Acceptable: Client must accept text/event-stream',
				},
				id: null,
			});
			return new Response(body, { status: 406 });
		}

		const connectionId = randomUUID();
		const lastEventId = req.headers.get('last-event-id');
		const lastEventIdStr = Array.isArray(lastEventId) ? lastEventId[0] : lastEventId;

		// Prepare response headers
		const headers: Record<string, string> = {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			Connection: 'keep-alive',
		};

		// Only include session ID header if session management is enabled
		if (this._enableSessionManagement) {
			headers['mcp-session-id'] = this._sessionId;
		}

		// Create a Transform Stream for SSE
		const { readable, writable } = new TransformStream();
		const writer = writable.getWriter();
		const encoder = new TextEncoder();

		// res.writeHead(200, headers);

		const connection: StreamConnection = {
			writer,
			encoder,
			lastEventId: lastEventIdStr,
			messages: [],
		};

		this._connections.set(connectionId, connection);

		// if there is a Last-Event-ID, replay messages on this connection
		if (lastEventIdStr) {
			this.replayMessages(connectionId, lastEventIdStr);
		}

		// TODO: There isn't an obvious replacement for this using the TransformStream API
		// res.on('close', () => {
		// 	this._connections.delete(connectionId);
		// 	// remove all request mappings associated with this connection
		// 	for (const [reqId, connId] of this._requestConnections.entries()) {
		// 		if (connId === connectionId) {
		// 			this._requestConnections.delete(reqId);
		// 		}
		// 	}
		// 	if (this._connections.size === 0) {
		// 		this.onclose?.();
		// 	}
		// });

		return new Response(readable, {
			headers: headers,
			status: 200,
		});
	}

	/**
	 * Handles POST requests containing JSON-RPC messages
	 */
	private async handlePostRequest(req: Request, parsedBody?: unknown): Promise<Response> {
		try {
			// validate the Accept header
			const acceptHeader = req.headers.get('accept');
			if (!acceptHeader || (!acceptHeader.includes('application/json') && !acceptHeader.includes('text/event-stream'))) {
				const body = JSON.stringify({
					jsonrpc: '2.0',
					error: {
						code: -32000,
						message: 'Not Acceptable: Client must accept application/json and/or text/event-stream',
					},
					id: null,
				});
				return new Response(body, { status: 406 });
			}

			const ct = req.headers.get('content-type');
			if (!ct || !ct.includes('application/json')) {
				const body = JSON.stringify({
					jsonrpc: '2.0',
					error: {
						code: -32000,
						message: 'Unsupported Media Type: Content-Type must be application/json',
					},
					id: null,
				});
				return new Response(body, { status: 415 });
			}

			let rawMessage;
			if (parsedBody !== undefined) {
				rawMessage = parsedBody;
			} else {
				const parsedCt = contentType.parse(ct);
				const body = await getRawBody(req, {
					limit: MAXIMUM_MESSAGE_SIZE,
					encoding: parsedCt.parameters.charset ?? 'utf-8',
				});
				rawMessage = JSON.parse(body.toString());
			}

			let messages: JSONRPCMessage[];

			// handle batch and single messages
			if (Array.isArray(rawMessage)) {
				messages = rawMessage.map((msg) => JSONRPCMessageSchema.parse(msg));
			} else {
				messages = [JSONRPCMessageSchema.parse(rawMessage)];
			}

			// Check if this is an initialization request
			// https://spec.modelcontextprotocol.io/specification/2025-03-26/basic/lifecycle/
			const isInitializationRequest = messages.some((msg) => 'method' in msg && msg.method === 'initialize' && 'id' in msg);

			// check if it contains requests
			const hasRequests = messages.some((msg) => 'method' in msg && 'id' in msg);
			const hasOnlyNotificationsOrResponses = messages.every(
				(msg) => ('method' in msg && !('id' in msg)) || 'result' in msg || 'error' in msg
			);

			if (hasOnlyNotificationsOrResponses) {
				// handle each message
				for (const message of messages) {
					this.onmessage?.(message);
				}

				// if it only contains notifications or responses, return 202
				return new Response(null, { status: 202 });
			} else if (hasRequests) {
				// if it contains requests, you can choose to return an SSE stream or a JSON response
				const useSSE = acceptHeader.includes('text/event-stream');

				if (useSSE) {
					const headers: Record<string, string> = {
						'Content-Type': 'text/event-stream',
						'Cache-Control': 'no-cache',
						Connection: 'keep-alive',
					};

					// Only include session ID header if session management is enabled
					// Always include session ID for initialization requests
					if (this._enableSessionManagement || isInitializationRequest) {
						headers['mcp-session-id'] = this._sessionId;
					}

					// Create a Transform Stream for SSE
					const { readable, writable } = new TransformStream();
					const writer = writable.getWriter();
					const encoder = new TextEncoder();

					// res.writeHead(200, headers);

					const connectionId = randomUUID();
					const connection: StreamConnection = {
						writer,
						encoder,
						messages: [],
					};

					this._connections.set(connectionId, connection);

					// map each request to a connection ID
					for (const message of messages) {
						if ('method' in message && 'id' in message) {
							this._requestConnections.set(String(message.id), connectionId);
						}
						this.onmessage?.(message);
					}

					// TODO: There isn't an obvious replacement for this using the TransformStream API
					// res.on('close', () => {
					// 	this._connections.delete(connectionId);
					// 	// remove all request mappings associated with this connection
					// 	for (const [reqId, connId] of this._requestConnections.entries()) {
					// 		if (connId === connectionId) {
					// 			this._requestConnections.delete(reqId);
					// 		}
					// 	}
					// 	if (this._connections.size === 0) {
					// 		this.onclose?.();
					// 	}
					// });

					return new Response(readable, {
						headers: headers,
						status: 200,
					});
				} else {
					// use direct JSON response
					const headers: Record<string, string> = {
						'Content-Type': 'application/json',
					};

					// Only include session ID header if session management is enabled
					// Always include session ID for initialization requests
					if (this._enableSessionManagement || isInitializationRequest) {
						headers['mcp-session-id'] = this._sessionId;
					}

					// handle each message
					for (const message of messages) {
						this.onmessage?.(message);
					}

					// TODO: It's not clear to me that this case is necessary based on the spec,
					// or if included, how the responses to the requests would be sent back to the client
					// I think you'd just get an error that there are no active connections?

					return new Response(null, {
						headers: headers,
						status: 200,
					});
				}
			}
		} catch (error) {
			// return JSON-RPC formatted error
			const body = JSON.stringify({
				jsonrpc: '2.0',
				error: {
					code: -32700,
					message: 'Parse error',
					data: String(error),
				},
				id: null,
			});

			this.onerror?.(error as Error);
			return new Response(body, { status: 400 });
		}
	}

	/**
	 * Handles DELETE requests to terminate sessions
	 */
	private async handleDeleteRequest(req: Request): Promise<Response> {
		await this.close();
		return new Response(null, { status: 200 });
	}

	/**
	 * Replays messages after the specified event ID for a specific connection
	 */
	private replayMessages(connectionId: string, lastEventId: string): void {
		if (!lastEventId) return;

		// only replay messages that should be sent on this connection
		const messages = Array.from(this._messageHistory.entries())
			.filter(([id, { connectionId: msgConnId }]) => id > lastEventId && (!msgConnId || msgConnId === connectionId)) // only replay messages that are not specified to a connection or specified to the current connection
			.sort(([a], [b]) => a.localeCompare(b));

		const connection = this._connections.get(connectionId);
		if (!connection) return;

		for (const [id, { message }] of messages) {
			connection.writer.write(`id: ${id}\nevent: message\ndata: ${JSON.stringify(message)}\n\n`);
		}
	}

	async close(): Promise<void> {
		for (const connection of this._connections.values()) {
			connection.writer.close();
		}
		this._connections.clear();
		this._messageHistory.clear();
		this._requestConnections.clear();
		this.onclose?.();
	}

	async send(message: JSONRPCMessage): Promise<void> {
		if (this._connections.size === 0) {
			throw new Error('No active connections');
		}

		let targetConnectionId = '';

		// if it is a response, find the corresponding request connection
		if ('id' in message && ('result' in message || 'error' in message)) {
			const connId = this._requestConnections.get(String(message.id));

			// if the corresponding connection is not found, the connection may be disconnected
			if (!connId || !this._connections.has(connId)) {
				// select an available connection
				const firstConnId = this._connections.keys().next().value;
				if (firstConnId) {
					targetConnectionId = firstConnId;
				} else {
					throw new Error('No available connections');
				}
			} else {
				targetConnectionId = connId;
			}
		} else {
			// for other messages, select an available connection
			const firstConnId = this._connections.keys().next().value;
			if (firstConnId) {
				targetConnectionId = firstConnId;
			} else {
				throw new Error('No available connections');
			}
		}

		const messageId = randomUUID();
		this._messageHistory.set(messageId, {
			message,
			connectionId: targetConnectionId,
		});

		// keep the message history in a reasonable range
		if (this._messageHistory.size > 1000) {
			const oldestKey = Array.from(this._messageHistory.keys())[0];
			this._messageHistory.delete(oldestKey);
		}

		// send the message to all active connections
		for (const [connId, connection] of this._connections.entries()) {
			// if it is a response message, only send to the target connection
			if ('id' in message && ('result' in message || 'error' in message)) {
				if (connId === targetConnectionId) {
					connection.writer.write(`id: ${messageId}\nevent: message\ndata: ${JSON.stringify(message)}\n\n`);
				}
			} else {
				// for other messages, send to all connections
				connection.writer.write(`id: ${messageId}\nevent: message\ndata: ${JSON.stringify(message)}\n\n`);
			}
		}
	}

	/**
	 * Returns the session ID for this transport
	 */
	get sessionId(): string {
		return this._sessionId;
	}
}
