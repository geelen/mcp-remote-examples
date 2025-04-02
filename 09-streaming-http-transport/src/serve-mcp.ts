import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from './streamable-http.js';

export function serveMcp<Env>({ server }: { server: McpServer }) {
	return async (request: Request, env: Env, ctx: ExecutionContext) => {
		let transport = new StreamableHTTPServerTransport({
			// start transport in stateless mode
			enableSessionManagement: false,
		});

		server.connect(transport);
		let res = await transport.handleRequest(request);

		return new Response('Hello World');
	};
}
