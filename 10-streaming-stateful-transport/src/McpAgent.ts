import { Agent } from 'agents';
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
	RequestId,
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
// when it gets merged
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

	#getWebSocket: () => WebSocket | null;
	#started = false;
	constructor(getWebSocket: () => WebSocket | null) {
		this.#getWebSocket = getWebSocket;
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
		const websocket = this.#getWebSocket();
		if (!websocket) {
			throw new Error('WebSocket not connected');
		}
		try {
			websocket.send(JSON.stringify(message));
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

export abstract class McpAgent<Props extends Record<string, unknown> = Record<string, unknown>> extends Agent<Env> {
	#connected = false;
	#transport?: McpTransport;
	#initialized = false;
	#initRun = false;
	abstract server: McpServer;
	abstract init(): Promise<void>;
	props!: Props;

	async onStart() {
		this.props = (await this.ctx.storage.get('props')) as Props;
		this.init?.();

		// Connect to the MCP server
		this.#transport = new McpTransport(() => this.getWebSocket());
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
		if (this.#connected) {
			return new Response('WebSocket already connected', { status: 400 });
		}

		// Defer to the Agent's fetch method to handle the WebSocket connection
		// PartyServer does a lot to manage the connections under the hood
		const response = await super.fetch(request);
		this.#connected = true;

		// Connect to the MCP server
		this.#transport = new McpTransport(() => this.getWebSocket());
		await this.server.connect(this.#transport);

		return response;
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

	getWebSocket() {
		const websockets = this.ctx.getWebSockets();
		if (websockets.length === 0) {
			return null;
		}
		return websockets[0];
	}

	getWebSocketForResponseID(id: string) {
		const websockets = this.ctx.getWebSockets();
		if (websockets.length === 0) {
			return null;
		}
		return websockets[0];
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

				// Accept the WebSocket
				ws.accept();

				// Handle messages from the Durable Object
				ws.addEventListener('message', async (event) => {
					try {
						const message = JSON.parse(event.data);

						// validate that the message is a valid JSONRPC message
						const result = JSONRPCMessageSchema.safeParse(message);
						if (!result.success) {
							// The message was not a valid JSONRPC message, so we will drop it
							// PartyKit will broadcast state change messages to all connected clients
							// and we need to filter those out so they are not passed to MCP clients
							return;
						}

						// Send the message as an SSE event
						const messageText = `event: message\ndata: ${JSON.stringify(result.data)}\n\n`;
						await writer.write(encoder.encode(messageText));
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

				// TODO: Send the messages to the agent
				// If there are no requests, we send the messages to the agent and acknowledge the request with a 202
				// const hasOnlyNotificationsOrResponses = parsedMessages.every((msg) => msg.type === 'notification' || msg.type === 'response');
				// if (hasOnlyNotificationsOrResponses) {
				// 	// TODO: Pass the messages to the agent
				// 	// for (const message of messages) {
				// 	// 	this.onmessage?.(message.message);
				// 	// }

				// 	return new Response(null, { status: 202 });
				// }

				// Return the SSE response
				return new Response(readable, {
					headers: {
						'Content-Type': 'text/event-stream',
						'Cache-Control': 'no-cache',
						Connection: 'keep-alive',
						'Access-Control-Allow-Origin': corsOptions?.origin || '*',
					},
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
