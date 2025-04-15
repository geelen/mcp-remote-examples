import { Agent, Connection, WSMessage } from 'agents';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
	InitializeRequestSchema,
	JSONRPCError,
	JSONRPCErrorSchema,
	JSONRPCMessage,
	JSONRPCMessageSchema,
	JSONRPCNotification,
	JSONRPCNotificationSchema,
	JSONRPCRequest,
	JSONRPCRequestSchema,
	JSONRPCResponse,
	JSONRPCResponseSchema,
} from '@modelcontextprotocol/sdk/types.js';

const MAXIMUM_MESSAGE_SIZE_BYTES = 4194304; // 4mb in bytes

// CORS helper function
function handleCORS(request: Request, corsOptions?: CORSOptions): Response | null {
	const origin = request.headers.get('Origin') || '*';
	const corsHeaders = {
		'Access-Control-Allow-Origin': corsOptions?.origin || origin,
		'Access-Control-Allow-Methods': corsOptions?.methods || 'GET, POST, OPTIONS',
		'Access-Control-Allow-Headers': corsOptions?.headers || 'Content-Type',
		'Access-Control-Max-Age': (corsOptions?.maxAge || 86400).toString(),
	};

	if (request.method === 'OPTIONS') {
		return new Response(null, { headers: corsHeaders });
	}

	return null;
}

interface CORSOptions {
	origin?: string;
	methods?: string;
	headers?: string;
	maxAge?: number;
}

type ParseMessageResult =
	| {
			type: 'request';
			message: JSONRPCRequest;
			isInitializationRequest: boolean;
	  }
	| {
			type: 'notification';
			message: JSONRPCNotification;
	  }
	| {
			type: 'response';
			message: JSONRPCResponse;
	  }
	| {
			type: 'error';
			message: JSONRPCError;
	  };

// TODO: Swap to https://github.com/modelcontextprotocol/typescript-sdk/pull/281
// when it gets released
function parseMessage(message: JSONRPCMessage): ParseMessageResult {
	const requestResult = JSONRPCRequestSchema.safeParse(message);
	if (requestResult.success) {
		return {
			type: 'request',
			message: requestResult.data,
			isInitializationRequest: InitializeRequestSchema.safeParse(message).success,
		};
	}

	const notificationResult = JSONRPCNotificationSchema.safeParse(message);
	if (notificationResult.success) {
		return {
			type: 'notification',
			message: notificationResult.data,
		};
	}

	const responseResult = JSONRPCResponseSchema.safeParse(message);
	if (responseResult.success) {
		return {
			type: 'response',
			message: responseResult.data,
		};
	}

	const errorResult = JSONRPCErrorSchema.safeParse(message);
	if (errorResult.success) {
		return {
			type: 'error',
			message: errorResult.data,
		};
	}

	// JSONRPCMessage is a union of these 4 types, so if we have a valid
	// JSONRPCMessage, we should not get this error
	throw new Error('Invalid message');
}

class McpTransport implements Transport {
	onclose?: () => void;
	onerror?: (error: Error) => void;
	onmessage?: (message: JSONRPCMessage) => void;
	sessionId?: string;

	// TODO: If there is an open connection to send server-initiated messages
	// back, we should use that connection
	#getWebSocketForGetRequest: () => WebSocket | null;

	// Get the appropriate websocket connection for a given message id
	#getWebSocketForMessageID: (id: string) => WebSocket | null;

	// Notify the server that a response has been sent for a given message id
	// so that it may clean up it's mapping of message ids to connections
	// once they are no longer needed
	#notifyResponseIdSent: (id: string) => void;

	#started = false;
	constructor(getWebSocketForMessageID: (id: string) => WebSocket | null, notifyResponseIdSent: (id: string | number) => void) {
		this.#getWebSocketForMessageID = getWebSocketForMessageID;
		this.#notifyResponseIdSent = notifyResponseIdSent;
		// TODO
		this.#getWebSocketForGetRequest = () => null;
	}

	async start() {
		// The transport does not manage the WebSocket connection since it's terminated
		// by the Durable Object in order to allow hibernation. There's nothing to initialize.
		if (this.#started) {
			throw new Error('Transport already started');
		}
		this.#started = true;
	}

	async send(message: JSONRPCMessage) {
		if (!this.#started) {
			throw new Error('Transport not started');
		}

		let websocket: WebSocket | null = null;
		let parsedMessage = parseMessage(message);
		switch (parsedMessage.type) {
			// These types have an id
			case 'response':
			case 'error':
				websocket = this.#getWebSocketForMessageID(parsedMessage.message.id);
				if (!websocket) {
					throw new Error(`Could not find WebSocket for message id: ${parsedMessage.message.id}`);
				}
				break;
			// requests have an ID but are originated by the server so do not correspond to
			// any active connection
			case 'request':
				websocket = this.#getWebSocketForGetRequest();
				break;
			// Notifications do not have an id
			case 'notification':
				websocket = this.#getWebSocketForGetRequest();
				// I'm a little confused about things like progress notifications,
				// which are correlated with a specific request but do not have an id
				// Should we drop these? Create a map of progressTokens and send them
				// along the same connection? Only send them if there is an open connection
				// initiated using GET?
				// https://modelcontextprotocol.io/specification/2025-03-26/basic/utilities/progress
				//
				// https://modelcontextprotocol.io/specification/2025-03-26/basic/transports#streamable-http
				// The spec says re:POST
				// The server MAY send JSON-RPC requests and notifications before sending a JSON-RPC
				// response. These messages SHOULD relate to the originating client request. These
				// requests and notifications MAY be batched.
				//
				// On the GET stream we also have:
				// These messages SHOULD be unrelated to any concurrently-running JSON-RPC request
				// from the client.
				//
				// So I think we'll need a mapping of progressTokens to IDs to comply. We'll implement
				// this later.
				break;
		}

		try {
			websocket?.send(JSON.stringify(message));
			if (parsedMessage.type === 'response') {
				this.#notifyResponseIdSent(parsedMessage.message.id.toString());
			}
		} catch (error) {
			this.onerror?.(error as Error);
			throw error;
		}
	}

	async close() {
		// Similar to start, the only thing to do is to pass the event on to the server
		this.onclose?.();
	}
}

export abstract class McpAgent<
	Props extends Record<string, unknown> = Record<string, unknown>,
	State = unknown,
	Env = unknown
> extends Agent<Env, State> {
	#connected = false;
	#transport?: McpTransport;
	#initialized = false;
	#initRun = false;
	#requestIdToConnectionId: Map<string | number, string> = new Map();

	abstract server: McpServer;
	abstract init(): Promise<void>;
	props!: Props;

	async onStart() {
		this.props = (await this.ctx.storage.get('props')) as Props;
		this.init?.();

		// Connect to the MCP server
		this.#transport = new McpTransport(
			(id) => this.getWebSocketForResponseID(id.toString()),
			(id) => this.#requestIdToConnectionId.delete(id)
		);
		await this.server.connect(this.#transport);
	}

	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);
		const sessionId = url.searchParams.get('sessionId');
		if (!sessionId) {
			return new Response('Missing sessionId', { status: 400 });
		}

		// For now, each agent can only have one connection
		// If we get an upgrade while already connected, we should error
		// if (this.#connected) {
		// 	return new Response('WebSocket already connected', { status: 400 });
		// }

		// Defer to the Agent's fetch method to handle the WebSocket connection
		// PartyServer does a lot to manage the connections under the hood
		const response = await super.fetch(request);
		this.#connected = true;

		// Connect to the MCP server
		// TODO: This feels a little contrived
		if (!this.#transport) {
			this.#transport = new McpTransport(
				(id) => this.getWebSocketForResponseID(id),
				(id) => this.#requestIdToConnectionId.delete(id)
			);
			await this.server.connect(this.#transport);
		}

		return response;
	}

	async onMessage(connection: Connection, event: WSMessage) {
		let message: JSONRPCMessage;
		try {
			// Ensure event is a string
			const data = typeof event === 'string' ? event : new TextDecoder().decode(event);
			message = JSONRPCMessageSchema.parse(JSON.parse(data));
		} catch (error) {
			this.#transport?.onerror?.(error as Error);
			return;
		}

		// determine the type of message
		const parsedMessage = parseMessage(message);
		switch (parsedMessage.type) {
			case 'request':
				this.#requestIdToConnectionId.set(parsedMessage.message.id.toString(), connection.id);
				break;
			case 'response':
			case 'notification':
			case 'error':
				break;
		}

		this.#transport?.onmessage?.(message);
	}

	async _init(props: Props) {
		await this.ctx.storage.put('props', props);
		this.props = props;
		if (!this.#initRun) {
			this.#initRun = true;
			await this.init();
		}
		this.#initialized = true;
	}

	isInitialized() {
		return this.#initialized;
	}

	getWebSocketForResponseID(id: string): WebSocket | null {
		let connectionId = this.#requestIdToConnectionId.get(id);
		if (connectionId === undefined) {
			return null;
		}
		return this.getConnection(connectionId) ?? null;
	}

	static mount(path: string, { binding = 'MCP_OBJECT', corsOptions }: { binding?: string; corsOptions?: CORSOptions } = {}) {
		let pathname = path;
		if (path === '/') {
			pathname = '/*';
		}
		const basePattern = new URLPattern({ pathname });

		return async (request: Request, env: Record<string, DurableObjectNamespace<McpAgent>>, ctx: ExecutionContext) => {
			// Handle CORS preflight
			const corsResponse = handleCORS(request, corsOptions);
			if (corsResponse) {
				return corsResponse;
			}

			const url = new URL(request.url);
			const namespace = env[binding];

			if (request.method === 'POST' && basePattern.test(url)) {
				// validate the Accept header
				const acceptHeader = request.headers.get('accept');
				// The client MUST include an Accept header, listing both application/json and text/event-stream as supported content types.
				if (!acceptHeader?.includes('application/json') || !acceptHeader.includes('text/event-stream')) {
					const body = JSON.stringify({
						jsonrpc: '2.0',
						error: {
							code: -32000,
							message: 'Not Acceptable: Client must accept application/json and text/event-stream',
						},
						id: null,
					});
					return new Response(body, { status: 406 });
				}

				const ct = request.headers.get('content-type');
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

				// Check content length against maximum allowed size
				const contentLength = parseInt(request.headers.get('content-length') ?? '0');
				if (contentLength > MAXIMUM_MESSAGE_SIZE_BYTES) {
					const body = JSON.stringify({
						jsonrpc: '2.0',
						error: {
							code: -32000,
							message: `Request body too large. Maximum size is ${MAXIMUM_MESSAGE_SIZE_BYTES} bytes`,
						},
						id: null,
					});
					return new Response(body, { status: 413 });
				}

				let sessionId = request.headers.get('mcp-session-id');

				let rawMessage = await request.json();
				let messages: JSONRPCMessage[];
				let parsedMessages: ParseMessageResult[];

				// handle batch and single messages
				if (Array.isArray(rawMessage)) {
					messages = rawMessage.map((msg) => JSONRPCMessageSchema.parse(msg));
				} else {
					messages = [JSONRPCMessageSchema.parse(rawMessage)];
				}
				parsedMessages = messages.map(parseMessage);

				// Before we pass the messages to the agent, there's another error condition we need to enforce
				// Check if this is an initialization request
				// https://spec.modelcontextprotocol.io/specification/2025-03-26/basic/lifecycle/
				const isInitializationRequest = parsedMessages.some((msg) => msg.type === 'request' && msg.isInitializationRequest);

				if (isInitializationRequest && sessionId) {
					const body = JSON.stringify({
						jsonrpc: '2.0',
						error: {
							code: -32600,
							message: 'Invalid Request: Initialization requests must not include a sessionId',
						},
						id: null,
					});
					return new Response(body, { status: 400 });
				}

				// The initialization request must be the only request in the batch
				if (isInitializationRequest && messages.length > 1) {
					const body = JSON.stringify({
						jsonrpc: '2.0',
						error: {
							code: -32600,
							message: 'Invalid Request: Only one initialization request is allowed',
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
						jsonrpc: '2.0',
						error: {
							code: -32600,
							message: 'Bad Request: Mcp-Session-Id header is required',
						},
						id: null,
					});
					return new Response(body, { status: 400 });
				}

				// If we don't have a sessionId, we are serving an initialization request
				// and need to generate a new sessionId
				sessionId = sessionId ?? namespace.newUniqueId().toString();

				// fetch the agent DO
				let id = namespace.idFromString(sessionId);
				let doStub = namespace.get(id);

				if (isInitializationRequest) {
					await doStub._init(ctx.props);
				} else if (!doStub.isInitialized()) {
					// if we have gotten here, then a session id that was never initialized
					// was provided
					const body = JSON.stringify({
						jsonrpc: '2.0',
						error: {
							code: -32001,
							message: 'Session not found',
						},
						id: null,
					});
					return new Response(body, { status: 400 });
				}

				// We've evaluated all the error conditions! Now it's time to establish
				// all the streams

				// Create a Transform Stream for SSE
				const { readable, writable } = new TransformStream();
				const writer = writable.getWriter();
				const encoder = new TextEncoder();

				// Connect to the Durable Object via WebSocket
				const upgradeUrl = new URL(request.url);
				upgradeUrl.searchParams.set('sessionId', sessionId);
				const response = await doStub.fetch(
					new Request(upgradeUrl, {
						headers: {
							Upgrade: 'websocket',
							// Required by PartyServer
							'x-partykit-room': sessionId,
						},
					})
				);

				// Get the WebSocket
				const ws = response.webSocket;
				if (!ws) {
					console.error('Failed to establish WebSocket connection');

					await writer.close();
					const body = JSON.stringify({
						jsonrpc: '2.0',
						error: {
							code: -32001,
							message: 'Failed to establish WebSocket connection',
						},
						id: null,
					});
					return new Response(body, { status: 500 });
				}

				// Keep track of the request ids that we have sent to the server
				// so that we can close the connection once we have received
				// all the responses
				let requestIds: Set<string | number> = new Set();

				// Accept the WebSocket
				ws.accept();

				// Handle messages from the Durable Object
				ws.addEventListener('message', async (event) => {
					try {
						const data = typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data);
						const message = JSON.parse(data);

						// validate that the message is a valid JSONRPC message
						const result = JSONRPCMessageSchema.safeParse(message);
						if (!result.success) {
							// The message was not a valid JSONRPC message, so we will drop it
							// PartyKit will broadcast state change messages to all connected clients
							// and we need to filter those out so they are not passed to MCP clients
							return;
						}

						// If the message is a response, add the id to the set of request ids
						const parsedMessage = parseMessage(result.data);
						switch (parsedMessage.type) {
							case 'response':
							case 'error':
								requestIds.add(parsedMessage.message.id);
								break;
							case 'notification':
							case 'request':
								break;
						}

						// Send the message as an SSE event
						const messageText = `event: message\ndata: ${JSON.stringify(result.data)}\n\n`;
						await writer.write(encoder.encode(messageText));

						// If we have received all the responses, close the connection
						if (requestIds.size === messages.length) {
							ws.close();
						}
					} catch (error) {
						console.error('Error forwarding message to SSE:', error);
					}
				});

				// Handle WebSocket errors
				ws.addEventListener('error', async (error) => {
					try {
						await writer.close();
					} catch (e) {
						// Ignore errors when closing
					}
				});

				// Handle WebSocket closure
				ws.addEventListener('close', async () => {
					try {
						await writer.close();
					} catch (error) {
						console.error('Error closing SSE connection:', error);
					}
				});

				// If there are no requests, we send the messages to the agent and acknowledge the request with a 202
				// since we don't expect any responses back through this connection
				const hasOnlyNotificationsOrResponses = parsedMessages.every((msg) => msg.type === 'notification' || msg.type === 'response');
				if (hasOnlyNotificationsOrResponses) {
					for (const message of messages) {
						ws.send(JSON.stringify(message));
					}

					// closing the websocket will also close the SSE connection
					ws.close();

					return new Response(null, { status: 202 });
				}

				for (const message of messages) {
					let parsedMessage = parseMessage(message);
					switch (parsedMessage.type) {
						case 'request':
							requestIds.add(parsedMessage.message.id);
							break;
						case 'notification':
						case 'response':
						case 'error':
							break;
					}
					ws.send(JSON.stringify(message));
				}

				// Return the SSE response. We handle closing the stream in the ws "message"
				// handler
				return new Response(readable, {
					headers: {
						'Content-Type': 'text/event-stream',
						'Cache-Control': 'no-cache',
						Connection: 'keep-alive',
						'mcp-session-id': sessionId,
						'Access-Control-Allow-Origin': corsOptions?.origin || '*',
					},
					status: 200,
				});
			}

			// We don't yet support GET or DELETE requests
			const body = JSON.stringify({
				jsonrpc: '2.0',
				error: {
					code: -32000,
					message: 'Method not allowed',
				},
				id: null,
			});
			return new Response(body, { status: 405 });
		};
	}
}
