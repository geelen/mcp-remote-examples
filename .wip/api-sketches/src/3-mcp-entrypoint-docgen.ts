import { Hono } from 'hono'
import { basicAuth } from 'hono/basic-auth'

import { WorkerEntrypoint, env } from 'cloudflare:workers'
import { WorkersMCP, mcp } from 'dream:code'

/**
 * =============================================
 * Stateless MCP server, documented using JSDoc
 * with a build-time metadata extraction step.
 * This will require a bit more work but unifies
 * MCP and Workers RPC.
 * =============================================
 */

/**
 * JSDoc-powered MCP server Demo
 * @version 1.0.0
 */
class McpEntrypoint extends WorkerEntrypoint {
  /**
   * Add two numbers the way only MCP can
   */
  add(a: number /** The first number */, b: number /** The second number */) {
    return a + b
  }

  /**
   * List the Cloudflare accounts your user has access to
   */
  async listAccounts() {
    const response = await fetch('https://up.stream', {
      headers: {
        Authorization: `Bearer ${env.UPSTREAM_API_TOKEN}`,
      },
    })
    return response.json()
  }

  @mcp.tool(`
    Generate an image using the 'flux-1-schnell' model. Works best with 8 steps.
    @param {string} prompt - 
    @param {number} steps - 
  `)
  async generateImage(
    prompt: string /** A text description of the image you want to generate. */,
    steps: number /** The number of diffusion steps; higher values can improve quality but take longer. Must be between 4 and 8, inclusive. */,
  ): mcp.ImageResponse<'image/jpeg'> {
    const response = await env.AI.run('@cf/black-forest-labs/flux-1-schnell', {
      prompt,
      steps,
    })

    // Can use the response type info to transform the result at runtime
    return response.image
  }
}

/**
 * =============================================
 * Several ways we could serve this as-is
 * =============================================
 */

/**
 * 1. It's a totally generic WorkerEntrypoint, we need to
 *   wrap it in a WorkersMCP to serve it over HTTP + SSE
 */
/*export default*/ WorkersMCP.mount(McpEntrypoint, '/mcp')

/**
 * 2. Could add a way to mount into a Hono app
 */
const app = new Hono<{ Bindings: Env }>()

app.use(basicAuth({ username: 'admin', password: env.CLIENT_SECRET }))

app.get('/', async (c) => {
  /*...*/
})

McpEntrypoint.mount(McpEntrypoint, '/mcp')

/*export default*/ app

/**
 * 3. Within a ExportedHandler
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)
    const authHeader = request.headers.get('Authorization')
    const token = authHeader?.startsWith('Bearer ') && authHeader.split(' ')[1]

    if (token !== env.CLIENT_SECRET) return new Response('Unauthorized', { status: 401 })

    if (url.pathname === '/mcp') return WorkersMCP.serve(request, McpEntrypoint)

    // ...
  },
} satisfies ExportedHandler<Env>
