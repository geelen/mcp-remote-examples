import app from './routes'
import OAuthProvider from 'workers-oauth-provider'
import { DurableMCP } from 'mcp-entrypoint'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

export class MyMCP extends DurableMCP {
  server = new McpServer({
    name: 'Demo',
    version: '1.0.0',
  })
  async init() {
    this.server.tool('add', { a: z.number(), b: z.number() }, async ({ a, b }) => ({
      content: [{ type: 'text', text: String(a + b) }],
    }))
    this.server.tool('subtract', { a: z.number(), b: z.number() }, async ({ a, b }) => ({
      content: [{ type: 'text', text: String(b - a) }],
    }))
    this.server.tool('multiply', { a: z.number(), b: z.number() }, async ({ a, b }) => ({
      content: [{ type: 'text', text: String(a * b) }],
    }))
  }
}

// Export the OAuth handler as the default
export default new OAuthProvider({
  apiRoute: '/sse',
  apiHandler: MyMCP.mount('/sse'),
  defaultHandler: app,
  authorizeEndpoint: '/authorize',
  tokenEndpoint: '/token',
  clientRegistrationEndpoint: '/register',
})
