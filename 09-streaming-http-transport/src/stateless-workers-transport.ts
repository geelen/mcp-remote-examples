import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
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

export class StatelessWorkersTransport implements Transport {
	// track which requests have been processed by the server
	private _requests: Set<RequestId> = new Set();
	private _writer: WritableStreamDefaultWriter<any> | null = null;
	private _encoder: TextEncoder | null = null;
	private _started: boolean = false;

	onclose?: () => void;
	onerror?: (error: Error) => void;
	onmessage?: (message: JSONRPCMessage) => void;

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

	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		if (request.method === 'POST') {
			return await this.handlePostRequest(request);
		} else {
			return await this.handleUnsupportedRequest();
		}
	}

	/**
	 * Handles unsupported requests (GET, PUT, PATCH, etc.)
	 * For now we support only POST and DELETE requests. Support for GET for SSE connections will be added later.
	 */
	private async handleUnsupportedRequest(): Promise<Response> {
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

	private async handlePostRequest(req: Request): Promise<Response> {
		try {
			// validate the Accept header
			const acceptHeader = req.headers.get('accept');
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

			// Check content length against maximum allowed size
			const contentLength = parseInt(req.headers.get('content-length') ?? '0');
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
			let rawMessage = await req.json();

			let messages: ParseMessageResult[];

			// handle batch and single messages
			if (Array.isArray(rawMessage)) {
				messages = rawMessage.map((msg) => JSONRPCMessageSchema.parse(msg)).map(parseMessage);
			} else {
				messages = [JSONRPCMessageSchema.parse(rawMessage)].map(parseMessage);
			}

			// Check if this is an initialization request
			// https://spec.modelcontextprotocol.io/specification/2025-03-26/basic/lifecycle/
			const isInitializationRequest = messages.some((msg) => msg.type === 'request' && msg.isInitializationRequest);

			if (isInitializationRequest) {
				if (messages.length > 1) {
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
			}

			// check if it contains requests
			const hasOnlyNotificationsOrResponses = messages.every((msg) => msg.type === 'notification' || msg.type === 'response');

			if (hasOnlyNotificationsOrResponses) {
				// handle each message
				for (const message of messages) {
					this.onmessage?.(message.message);
				}

				// if it only contains notifications or responses, return 202
				return new Response(null, { status: 202 });
			}

			// We are always going to return an SSE stream for requests
			const headers: Record<string, string> = {
				'Content-Type': 'text/event-stream',
				'Cache-Control': 'no-cache',
				Connection: 'keep-alive',
			};

			const { readable, writable } = new TransformStream();
			this._writer = writable.getWriter();
			this._encoder = new TextEncoder();

			for (const message of messages) {
				// Need to split on type of JSONRPCMessage
				switch (message.type) {
					case 'request':
						// Mark that we have received this request, but not answered it yet
						this._requests.add(message.message.id);
						this.onmessage?.(message.message);
						break;
					case 'notification':
					case 'response':
					case 'error':
						// pass the rest on through to the MCP server
						this.onmessage?.(message.message);
						break;
				}
			}

			return new Response(readable, { headers, status: 200 });
		} catch (error: any) {
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

	async send(message: JSONRPCMessage): Promise<void> {
		if (!this._writer || !this._encoder) {
			throw new Error('Transport not started');
		}

		let parsedMessage = JSONRPCMessageSchema.safeParse(message);

		if (!parsedMessage.success) {
			throw new Error('Invalid message');
		}

		let parsed = parseMessage(parsedMessage.data);

		// if we are completing a request with either a result or an error,
		// remove it from the set of pending requests
		if (parsed.type === 'response' || parsed.type === 'error') {
			this._requests.delete(parsed.message.id);
		}

		this._writer.write(this._encoder.encode(`event: message\ndata: ${JSON.stringify(parsed.message)}\n\n`));

		// if we've processed all the requests, close the transport
		if (this._requests.size === 0) {
			await this._writer.close();
		}
	}

	async close(): Promise<void> {
		this.onclose?.();
	}
}
