import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WSServerTransport } from './websocket';
import { DurableObject } from 'cloudflare:workers';

export interface Env {
	MCP_DO: DurableObjectNamespace;
}

export class MyMcpServerDurableObject extends DurableObject {
	server: McpServer;
	transport: WSServerTransport;

	constructor(state: DurableObjectState, env: Env) {
		super(state, env);

		this.server = new McpServer({
			name: 'Demo',
			version: '1.0.0',
		});

		// Define the add tool with proper typing
		this.server.tool('add', 'Add two numbers', async (extra: any) => {
			const { a, b } = extra.params as { a: number; b: number };
			return {
				content: [{ type: 'text', text: String(a + b) }],
			};
		});

		this.server.resource('greeting', new ResourceTemplate('greeting://{name}', { list: undefined }), async (uri, { name }) => ({
			contents: [
				{
					uri: uri.href,
					text: `Hello, ${name}!`,
				},
			],
		}));

		this.transport = new WSServerTransport();
	}

	override async fetch(request: Request) {
		if (request.headers.get('Upgrade') === 'websocket') {
			await this.server.connect(this.transport);
			return this.transport.upgradeResponse;
		}

		return new Response('Expected WebSocket connection', { status: 400 });
	}
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);
		const sessionId = url.searchParams.get('sessionId');
		let object = env.MCP_DO.get(sessionId ? env.MCP_DO.idFromString(sessionId) : env.MCP_DO.newUniqueId());
		return object.fetch(request);
	},
} satisfies ExportedHandler<Env>;
