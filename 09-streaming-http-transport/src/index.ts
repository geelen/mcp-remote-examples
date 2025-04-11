import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { serveMcp } from './serve-mcp.js';
import { GetPromptResult, CallToolResult, ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';

// Create an MCP server with implementation details
const server = new McpServer({
	name: 'simple-streamable-http-server',
	version: '1.0.0',
});

// Register a simple tool that returns a greeting
server.tool(
	'greet',
	'A simple greeting tool',
	{
		name: z.string().describe('Name to greet'),
	},
	async ({ name }): Promise<CallToolResult> => {
		return {
			content: [
				{
					type: 'text',
					text: `Hello, ${name}!`,
				},
			],
		};
	}
);

// Register a simple prompt
server.prompt(
	'greeting-template',
	'A simple greeting prompt template',
	{
		name: z.string().describe('Name to include in greeting'),
	},
	async ({ name }): Promise<GetPromptResult> => {
		return {
			messages: [
				{
					role: 'user',
					content: {
						type: 'text',
						text: `Please greet ${name} in a friendly manner.`,
					},
				},
			],
		};
	}
);

// Register a tool that sends multiple greetings with notifications
server.tool(
	'multi-greet',
	'A tool that sends different greetings with delays between them',
	{
		name: z.string().describe('Name to greet'),
	},
	async ({ name }, { sendNotification }): Promise<CallToolResult> => {
		const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

		await sendNotification({
			method: "notifications/message",
			params: { level: "debug", data: `Starting multi-greet for ${name}` }
		});

		await sleep(1000); // Wait 1 second before first greeting

		await sendNotification({
			method: "notifications/message",
			params: { level: "info", data: `Sending first greeting to ${name}` }
		});

		await sleep(1000); // Wait another second before second greeting

		await sendNotification({
			method: "notifications/message",
			params: { level: "info", data: `Sending second greeting to ${name}` }
		});

		return {
			content: [
				{
					type: 'text',
					text: `Good morning, ${name}!`,
				}
			],
		};
	}
);

// Create a simple resource at a fixed URI
server.resource(
	'greeting-resource',
	'https://example.com/greetings/default',
	{ mimeType: 'text/plain' },
	async (): Promise<ReadResourceResult> => {
		return {
			contents: [
				{
					uri: 'https://example.com/greetings/default',
					text: 'Hello, world!',
				},
			],
		};
	}
);
export default {
	fetch: serveMcp({ server }),
} satisfies ExportedHandler<Env>;
