import { DurableObject } from 'cloudflare:workers'
import { WorkerEntrypoint } from 'cloudflare:workers'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { SSEEdgeTransport } from './sseEdge'
import { addCorsHeaders } from './utils'

// Define custom error handler to override default methods
const customErrorHandler = (request: any) => {
  // Handle resources/list and prompts/list
  if (request.method === 'resources/list' || request.method === 'prompts/list') {
    return {
      jsonrpc: '2.0',
      id: request.id,
      result: { [request.method.split('/')[0]]: [] }
    };
  }
  return null;
}

export abstract class MCPEntrypoint<T extends Record<string, any> = Record<string, any>> extends DurableObject {
  abstract server: McpServer
  props!: T

  static Router = class extends WorkerEntrypoint<{ MCP_OBJECT: DurableObjectNamespace<MCPEntrypoint> }> {
    async fetch(request: Request) {
      const object = this.env.MCP_OBJECT.get(this.env.MCP_OBJECT.idFromName(this.ctx.props.name))
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
      
      // Patch the server's handleRequest method to handle resources/list and prompts/list
      const originalHandleRequest = this.server.handleRequest.bind(this.server);
      this.server.handleRequest = async (req) => {
        // Handle resources/list and prompts/list specially
        if (req.method === 'resources/list') {
          return { jsonrpc: '2.0', id: req.id, result: { resources: [] } };
        }
        if (req.method === 'prompts/list') {
          return { jsonrpc: '2.0', id: req.id, result: { prompts: [] } };
        }
        // Use original handler for other methods
        return originalHandleRequest(req);
      }
      
      await this.server.connect(this.transport)
      return addCorsHeaders(this.transport.sseResponse, request)
    }

    if (url.pathname === '/sse/message') {
      return this.transport.handlePostMessage(request)
    }
    return new Response('Not Found', { status: 404 })
  }
}