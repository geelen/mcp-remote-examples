import { McpServer } from '@modelcontextprotocol/sdk/server/mcp'
import { z } from 'zod'
import { Hono } from 'hono'
import { basicAuth } from 'hono/basic-auth'

import { env } from 'cloudflare:workers'
import { WorkersMCP } from 'dream:code'

/**
 * =============================================
 * Completely stock standard McpServer definiton.
 * Importable env makes this work
 * =============================================
 */
const server = new McpServer({
  name: 'SDK-compatible Workers demo',
  version: '1.0.0',
})

server.tool(
  'add',
  'Add two numbers the way only MCP can',
  {
    a: z.number().describe(`The first number`),
    b: z.number().describe(`The second number`),
  },
  async ({ a, b }) => {
    return {
      content: [{ type: 'text', text: String(a + b) }],
    }
  },
)

server.tool('listAccounts', 'List the Cloudflare accounts your user has access to', {}, async () => {
  const accounts = await fetch('https://up.stream', {
    headers: {
      Authorization: `Bearer ${env.UPSTREAM_API_TOKEN}`,
    },
  }).then((res) => res.json())

  return {
    content: [{ type: 'text', text: JSON.stringify(accounts) }],
  }
})

server.tool(
  'generateImage',
  'Generate an image using the `flux-1-schnell` model. Works best with 8 steps.',
  {
    prompt: z.string().describe(`A text description of the image you want to generate.`),
    steps: z.number().min(4).max(8).describe(`
      The number of diffusion steps; higher values can improve quality but take longer. Must be between 4 and 8, inclusive.
    `),
  },
  async ({ prompt, steps }) => {
    const response = await env.AI.run('@cf/black-forest-labs/flux-1-schnell', {
      prompt,
      steps,
    })

    return {
      content: [{ type: 'image', data: response.image!, mimeType: 'image/jpeg' }],
    }
  },
)

/**
 * =============================================
 * Several ways we could serve this as-is
 * =============================================
 */

/**
 * 1. As the only route in the worker
 */
/*export default*/ WorkersMCP.mount(server, '/mcp')

/**
 * 2. Within a Hono app (e.g. for middleware)
 */
const app = new Hono<{ Bindings: Env }>()

app.use(basicAuth({ username: 'admin', password: env.CLIENT_SECRET }))

app.get('/', async (c) => {
  /*...*/
})

app.get('/mcp', async (c) => {
  return WorkersMCP.serve(c.req.raw, server)
})

/*export default*/ app

/**
 * 3. Call .serve with a ExportedHandler
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)
    const authHeader = request.headers.get('Authorization')
    const token = authHeader?.startsWith('Bearer ') && authHeader.split(' ')[1]

    if (token !== env.CLIENT_SECRET) return new Response('Unauthorized', { status: 401 })

    if (url.pathname === '/mcp') return WorkersMCP.serve(request, server)

    // ...
  },
} satisfies ExportedHandler<Env>
