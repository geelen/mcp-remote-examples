/**
 * DREEEEEEAAAM COOODE
 * I BELIEVE YOU CAN GET ME
 * THROUGH THE NIII-IIIIGHT
 */

interface Env {
  UPSTREAM_API_TOKEN: string
  CLIENT_SECRET: string
  AI: Ai
}

declare module 'cloudflare:workers' {
  export const env: Env
}

type FakeAnnotation<T> = (args: T) => (x) => x

type McpEntrypoint = WorkerEntrypoint & {
  mount: (hono: Hono, route: string) => {}
}

declare module 'dream:code' {
  const WorkersMCP: {
    mount(endpoint: string, server: MCPServer): any
    serve(request: Request, server: MCPServer): any

    Entypoint: WorkerEntrypoint
  }

  const mcp: FakeAnnotation<Record<string, string>> & {
    tool: FakeAnnotation<string>
    ImageResponse: (data: string, mimeType: string) => Response
  }
}
