import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { serveMcp } from './serve-mcp.js';

let server = new McpServer({
	name: 'Demo',
	version: '1.0.0',
});

server.tool('add', { a: z.number(), b: z.number() }, async ({ a, b }) => ({
	content: [{ type: 'text', text: String(a + b) }],
}));

server.tool('subtract', { a: z.number(), b: z.number() }, async ({ a, b }) => ({
	content: [{ type: 'text', text: String(b - a) }],
}));

server.tool('multiply', { a: z.number(), b: z.number() }, async ({ a, b }) => ({
	content: [{ type: 'text', text: String(a * b) }],
}));

export default {
	async fetch(request, env, ctx): Promise<Response> {
		let fetch = serveMcp({
			server,
		});
		return fetch(request, env, ctx);
	},
} satisfies ExportedHandler<Env>;
