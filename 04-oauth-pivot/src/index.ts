import OAuthProvider, { AuthRequest, OAuthHelpers } from 'workers-oauth-provider'
import { MCPEntrypoint } from './lib/MCPEntrypoint'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { Hono } from 'hono'
import pick from 'just-pick'
import { Octokit } from 'octokit'

// Context from the auth process, encrypted & stored in the auth token
// and provided to the MCP Server as ctx.props
type Props = {
  login: string
  name: string
  email: string
  accessToken: string
}

export class MyMCP extends MCPEntrypoint<Props> {
  get server() {
    const server = new McpServer({
      name: 'Github OAuth Proxy Demo',
      version: '1.0.0',
    })

    server.tool('add', 'Add two numbers the way only MCP can', { a: z.number(), b: z.number() }, async ({ a, b }) => ({
      content: [{ type: 'text', text: String(a + b) }],
    }))

    server.tool('whoami', 'Tasty props from my OAuth provider', {}, async () => ({
      content: [{ type: 'text', text: JSON.stringify(pick(this.props, 'login', 'name', 'email')) }],
    }))

    server.tool('userInfoHTTP', 'Get user info from GitHub, via HTTP', {}, async () => {
      const res = await fetch('https://api.github.com/user', {
        headers: { Authorization: `Bearer ${this.props.accessToken}`, 'User-Agent': '04-auth-pivot' },
      })
      return { content: [{ type: 'text', text: await res.text() }] }
    })

    server.tool('userInfoOctokit', 'Get user info from GitHub, via Octokit', {}, async () => {
      const octokit = new Octokit({ auth: this.props.accessToken })
      return { content: [{ type: 'text', text: JSON.stringify(octokit.rest.users.getAuthenticated()) }] }
    })
    return server
  }
}

const app = new Hono<{ Bindings: Env & { OAUTH_PROVIDER: OAuthHelpers } }>()

app.get('/authorize', async (c) => {
  const oauthReqInfo = await c.env.OAUTH_PROVIDER.parseAuthRequest(c.req.raw)
  // Store the request info in KV to catch ya up on the rebound
  const randomString = crypto.randomUUID()
  await c.env.OAUTH_KV.put(`login:${randomString}`, JSON.stringify(oauthReqInfo), { expirationTtl: 600 })

  const upstream = new URL(`https://github.com/login/oauth/authorize`)
  upstream.searchParams.set('client_id', c.env.GITHUB_CLIENT_ID)
  upstream.searchParams.set('redirect_uri', new URL('/callback', c.req.url).href)
  upstream.searchParams.set('scope', 'read:user')
  upstream.searchParams.set('state', randomString)
  upstream.searchParams.set('response_type', 'code')

  return Response.redirect(upstream.href)
})

app.get('/callback', async (c) => {
  const code = c.req.query('code') as string

  // Get the oathReqInfo out of KV
  const randomString = c.req.query('state')
  if (!randomString) {
    return c.text('Missing state', 400)
  }
  const oauthReqInfo = await c.env.OAUTH_KV.get<AuthRequest>(`login:${randomString}`, { type: 'json' })
  if (!oauthReqInfo) {
    return c.text('Invalid state', 400)
  }

  // Exchange the code for an access token
  const resp = await fetch(`https://github.com/login/oauth/access_token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: c.env.GITHUB_CLIENT_ID,
      client_secret: c.env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: new URL('/callback', c.req.url).href,
    }).toString(),
  })
  if (!resp.ok) {
    console.log(await resp.text())
    return c.text('Failed to fetch access token', 500)
  }
  const body = await resp.formData()
  const accessToken = body.get('access_token')
  if (!accessToken) {
    return c.text('Missing access token', 400)
  }

  // Fetch the user info from GitHub
  const apiRes = await fetch(`https://api.github.com/user`, {
    headers: {
      Authorization: `bearer ${accessToken}`,
      'User-Agent': '04-auth-pivot',
    },
  })
  if (!apiRes.ok) {
    console.log(await apiRes.text())
    return c.text('Failed to fetch user', 500)
  }

  const user = (await apiRes.json()) as Record<string, string>
  const { login, name, email } = user

  // Return back to the MCP client a new token
  const { redirectTo } = await c.env.OAUTH_PROVIDER.completeAuthorization({
    request: oauthReqInfo,
    userId: login,
    metadata: {
      label: name,
    },
    scope: oauthReqInfo.scope,
    // This will be available on this.props inside MyMCP
    props: {
      login,
      name,
      email,
      accessToken,
    } as Props,
  })

  return Response.redirect(redirectTo)
})

export default new OAuthProvider({
  apiRoute: '/sse',
  apiHandler: MyMCP.Router,
  defaultHandler: app,
  authorizeEndpoint: '/authorize',
  tokenEndpoint: '/token',
  clientRegistrationEndpoint: '/register',
})
