import { DurableObject, WorkerEntrypoint } from 'cloudflare:workers'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { SSEEdgeTransport } from './sseEdge'
import { addCorsHeaders } from './utils'
import { Hono } from 'hono'
import { cors, type CORSOptions } from 'hono/cors'

export abstract class MCPEntrypoint<
  T extends Record<string, any> = Record<string, any>,
> extends DurableObject {
  abstract server: McpServer
  props!: T

  static Router = class extends WorkerEntrypoint<{
    MCP_OBJECT: DurableObjectNamespace<MCPEntrypoint>
  }> {
    async fetch(request: Request) {
      console.log({
        request: request.url,
        method: request.method,
        headers: Object.fromEntries(request.headers.entries()),
      })
      const url = new URL(request.url)
      const sessionId = url.searchParams.get('sessionId')

      if (!sessionId && url.pathname !== '/sse') {
        return new Response(
          'Missing sessionId. Expected POST to /sse to initiate new one',
          { status: 400 }
        )
      }
      const id = sessionId
        ? this.env.MCP_OBJECT.idFromString(sessionId)
        : this.env.MCP_OBJECT.newUniqueId()
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
      this.transport = new SSEEdgeTransport(
        '/sse/message',
        this.ctx.id.toString()
      )
      await this.server.connect(this.transport)
      return addCorsHeaders(this.transport.sseResponse, request)
    }

    if (url.pathname === '/sse/message') {
      return this.transport.handlePostMessage(request)
    }
    return new Response('Not Found', { status: 404 })
  }
}

export abstract class DurableMCP<
  T extends Record<string, any> = Record<string, any>,
> extends DurableObject {
  abstract server: McpServer
  private transport!: SSEEdgeTransport
  props!: T
  initRun = false

  abstract init(): Promise<void>

  async _init(props: T) {
    console.log({ init: props })
    this.props = props
    if (!this.initRun) {
      this.initRun = true
      await this.init()
    }
  }

  async fetch(request: Request) {
    const url = new URL(request.url)
    console.log({ [this.ctx.id.toString()]: url.pathname })

    if (url.pathname === '/sse') {
      this.transport = new SSEEdgeTransport(
        '/sse/message',
        this.ctx.id.toString()
      )
      await this.server.connect(this.transport)
      return addCorsHeaders(this.transport.sseResponse, request)
    }

    if (url.pathname.startsWith('/sse/message')) {
      return this.transport.handlePostMessage(request)
    }
    return new Response('Not Found', { status: 404 })
  }

  static mount(
    path: string,
    {
      binding = 'MCP_OBJECT',
      corsOptions,
    }: {
      binding?: string
      corsOptions?: CORSOptions
    } = {}
  ) {
    const router = new Hono<{
      Bindings: { [binding]: DurableObjectNamespace<DurableMCP> }
    }>()

    router.get(path, cors(corsOptions), async (c) => {
      console.log('GET SSE')
      console.log(c.req.url)
      const namespace = c.env[binding]
      const object = namespace.get(namespace.newUniqueId())
      // @ts-ignore
      await object._init(c.executionCtx.props)
      return await object.fetch(c.req.raw)
    })

    router.post(path + '/message', cors(corsOptions), async (c) => {
      console.log('POST MESSAGE')
      console.log(c.req.url)
      const namespace = c.env[binding]
      const sessionId = c.req.query('sessionId')
      console.log({ sessionId })

      if (!sessionId) {
        return new Response(
          'Missing sessionId. Expected POST to /sse to initiate new one',
          { status: 400 }
        )
      }
      const object = namespace.get(namespace.idFromString(sessionId))
      return await object.fetch(c.req.raw)
    })

    return router
  }
}

export const WorkersMCP = {
  mountStateful({
    binding = 'MCP_OBJECT',
    route,
    server,
  }: {
    server: McpServer
    route: string
    binding?: string
  }) {
    class Router extends WorkerEntrypoint<{
      [binding]: DurableObjectNamespace<MCPEntrypoint>
    }> {
      async fetch(request: Request) {
        console.log({
          request: request.url,
          method: request.method,
          headers: Object.fromEntries(request.headers.entries()),
        })
        const url = new URL(request.url)
        const sessionId = url.searchParams.get('sessionId')

        if (!sessionId && url.pathname !== '/sse') {
          return new Response(
            'Missing sessionId. Expected POST to /sse to initiate new one',
            { status: 400 }
          )
        }
        const id = sessionId
          ? this.env[binding].idFromString(sessionId)
          : this.env[binding].newUniqueId()
        const object = this.env[binding].get(id)
        object.init(this.ctx.props)
        return object.fetch(request)
      }
    }

    class Session extends DurableObject {
      private transport!: SSEEdgeTransport

      async fetch(request: Request) {
        const url = new URL(request.url)

        if (url.pathname === route) {
          this.transport = new SSEEdgeTransport(
            '/sse/message',
            this.ctx.id.toString()
          )
          await server.connect(this.transport)
          return addCorsHeaders(this.transport.sseResponse, request)
        }

        if (url.pathname === '/sse/message') {
          return this.transport.handlePostMessage(request)
        }
        return new Response('Not Found', { status: 404 })
      }
    }

    return { Router, Session }
  },
}
