import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { GetPromptResult, CallToolResult, ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';

class MyMcpAgent extends McpAgent {
	server = new McpServer({
		name: 'simple-streamable-http-server',
		version: '1.0.0',
	});

	onStart() {
		// Register a simple tool that returns a greeting
		this.server.tool(
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
		this.server.prompt(
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

		// Create a simple resource at a fixed URI
		this.server.resource(
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
	}
}

export default MyMcpAgent.mount();
