import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StatelessWorkersTransport } from './stateless-workers-transport.js';

export function serveMcp({ server }: { server: McpServer }) {
	return async (request: Request, env: Env, ctx: ExecutionContext) => {
		let transport = new StatelessWorkersTransport();
		server.connect(transport);
		let res = await transport.fetch(request, env, ctx);
		return res;
	};
}
