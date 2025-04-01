import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
// import { StreamableHTTPServerTransport } from "./streamable-http.js";

// @ts-ignore
export function serveMcp<Env>({ server }: { server: McpServer; endpoint: string }) {
	return async (request: Request, env: Env, ctx: ExecutionContext) => {
		// let transport = new StreamableHTTPServerTransport(endpoint);
		// server.connect(transport);
		// let res = await transport.handleRequest(request, env, ctx);

		return new Response('Hello World');
	};
}
