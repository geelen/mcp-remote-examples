import app from './routes'
import OAuthProvider from 'workers-oauth-provider'
import { MCPEntrypoint } from 'mcp-entrypoint'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

export class MyMCP extends MCPEntrypoint {
  get server() {
    const server = new McpServer({
      name: 'Demo',
      version: '1.0.0',
    })
    server.tool('add', { a: z.number(), b: z.number() }, async ({ a, b }) => ({
      content: [{ type: 'text', text: String(a + b) }],
    }))
    // server.tool('subtract', { a: z.number(), b: z.number() }, async ({ a, b }) => ({
    //   content: [{ type: 'text', text: String(b - a) }],
    // }))
    // server.tool('multiply', { a: z.number(), b: z.number() }, async ({ a, b }) => ({
    //   content: [{ type: 'text', text: String(a * b) }],
    // }))
    return server
  }
}

// Export the OAuth handler as the default
export default new OAuthProvider({
  apiRoute: '/sse',
  apiHandler: MyMCP.Router,
  defaultHandler: app,
  authorizeEndpoint: '/authorize',
  tokenEndpoint: '/token',
  clientRegistrationEndpoint: '/register',
})
