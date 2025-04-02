import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from './streamable-http.js';

// @ts-ignore
export function serveMcp<Env>({ server }: { server: McpServer; endpoint: string }) {
	return async (request: Request, env: Env, ctx: ExecutionContext) => {
		// start transport in stateless mode
		let transport = new StreamableHTTPServerTransport('/mcp', {
			enableSessionManagement: false,
		});

		server.connect(transport);
		let res = await transport.handleRequest(request);

		return new Response('Hello World');
	};
}
