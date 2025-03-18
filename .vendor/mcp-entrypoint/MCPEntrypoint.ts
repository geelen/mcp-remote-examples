import { DurableObject } from 'cloudflare:workers'
import { WorkerEntrypoint } from 'cloudflare:workers'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { SSEEdgeTransport } from './sseEdge'
import { addCorsHeaders } from './utils'

export abstract class MCPEntrypoint<T extends Record<string, any> = Record<string, any>> extends DurableObject {
  abstract server: McpServer
  props!: T

  static Router = class extends WorkerEntrypoint<{ MCP_OBJECT: DurableObjectNamespace<MCPEntrypoint> }> {
    async fetch(request: Request) {
      console.log({ request: request.url, method: request.method, headers: Object.fromEntries(request.headers.entries()) })
      const url = new URL(request.url)
      const sessionId = url.searchParams.get('sessionId')

      if (!sessionId && url.pathname !== '/sse') {
        return new Response('Missing sessionId. Expected POST to /sse to initiate new one', { status: 400 })
      }
      const id = sessionId ? this.env.MCP_OBJECT.idFromString(sessionId) : this.env.MCP_OBJECT.newUniqueId()
      const object = this.env.MCP_OBJECT.get(id)
      object.init(this.ctx.props)
      return object.fetch(request)
    }
  }
  private transport!: SSEEdgeTransport

  init(props: T) {
    console.log({ init: props })
    this.props = props
  }

  async fetch(request: Request) {
    const url = new URL(request.url)

    if (url.pathname === '/sse') {
      this.transport = new SSEEdgeTransport('/sse/message', this.ctx.id.toString())
      await this.server.connect(this.transport)
      return addCorsHeaders(this.transport.sseResponse, request)
    }

    if (url.pathname === '/sse/message') {
      return this.transport.handlePostMessage(request)
    }
    return new Response('Not Found', { status: 404 })
  }
}
