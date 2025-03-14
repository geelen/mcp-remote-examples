import { Hono } from 'hono'
import { basicAuth } from 'hono/basic-auth'

import { WorkerEntrypoint, env } from 'cloudflare:workers'
import { WorkersMCP, mcp } from 'dream:code'

/**
 * =============================================
 * Stateless MCP server, implemented RPC-style
 * with decorator-based documentation (no build step)
 * =============================================
 */
@mcp({ name: 'Entrypoint demo', version: '1.0.0', route: '/mcp' })
class McpEntrypoint extends WorkerEntrypoint {
  @mcp.tool(`
    Add two numbers the way only MCP can
    
    @param a {number} The first number
    @param b {number} The second number
    @returns {number} The sum of the two numbers
  `)
  add(a: number, b: number) {
    return a + b
  }

  @mcp.tool(`
    List the Cloudflare accounts your user has access to
  `)
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
    @param {string} prompt - A text description of the image you want to generate.
    @param {number} steps - The number of diffusion steps; higher values can improve quality but take longer. Must be between 4 and 8, inclusive.
  `)
  async generateImage(prompt: string, steps: number) {
    const response = await env.AI.run('@cf/black-forest-labs/flux-1-schnell', {
      prompt,
      steps,
    })

    // Need a way to indicate that the response is an image
    return mcp.ImageResponse(response.image!, 'image/jpeg')
  }
}

/**
 * =============================================
 * Several ways we could serve this as-is
 * =============================================
 */

/**
 * 1. It's already a WorkerEntrypoint, can be exported directly
 */
/*export default*/ McpEntrypoint

/**
 * 2. Could add a way to mount into a Hono app
 */
const app = new Hono<{ Bindings: Env }>()

app.use(basicAuth({ username: 'admin', password: env.CLIENT_SECRET }))

app.get('/', async (c) => {
  /*...*/
})

McpEntrypoint.mount(app)
// or some version of app.mount('/mcp', McpEntrypoint)

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

    if (url.pathname === '/mcp') return new McpEntrypoint(env, ctx).fetch(request)

    // ...
  },
} satisfies ExportedHandler<Env>
