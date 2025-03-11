import app from './routes'
import OAuthProvider from './lib/OAuthProvider'
import { MCPEntrypoint } from './lib/MCPEntrypoint'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

export class MyMCP extends MCPEntrypoint {
  server = new McpServer({
    name: 'Demo',
    version: '1.0.0',
  })
  _ = (() => {
    this.server.tool('add', { a: z.number(), b: z.number() }, async ({ a, b }) => ({
      content: [{ type: 'text', text: String(a + b) }],
    }))
  })()
}

export const MyOauth = new OAuthProvider({
  apiRoute: '/sse',
  apiHandler: MyMCP.Router,
  defaultHandler: app,
  authorizeEndpoint: '/authorize',
  tokenEndpoint: '/token',
  clientRegistrationEndpoint: '/register',
})

export default MyOauth
