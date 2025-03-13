import OAuthProvider, { AuthRequest, OAuthHelpers } from 'workers-oauth-provider'
import { MCPEntrypoint } from './lib/MCPEntrypoint'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { Hono } from 'hono'

// Context from the auth process, encrypted & stored in the auth token
// and provided to the MCP Server as this.props
type Props = {
  username: string
  email: string
  token: Record<string, string>
}

export class MyMCP extends MCPEntrypoint<Props> {
  get server() {
    const server = new McpServer({
      name: 'Cloudflare OAuth Proxy Demo',
      version: '1.0.0',
    })

    server.tool('add', 'Add two numbers the way only MCP can', { a: z.number(), b: z.number() }, async ({ a, b }) => {
      return {
        content: [{ type: 'text', text: String(a + b) }],
      }
    })

    server.tool('listAccounts', 'List the Cloudflare accounts your user has access to', {}, async () => {
      // TODO: refresh token if expired
      const { access_token } = this.props.token
      const accounts = await fetch('https://api.cloudflare.com/client/v4/accounts', {
        headers: {
          Authorization: `Bearer ${access_token}`,
        },
      }).then((res) => res.json())

      return {
        content: [{ type: 'text', text: JSON.stringify(accounts) }],
      }
    })

    return server
  }
}

const app = new Hono<{ Bindings: Env & { OAUTH_PROVIDER: OAuthHelpers } }>()

app.get('/authorize', async (c) => {
  const oauthReqInfo = await c.env.OAUTH_PROVIDER.parseAuthRequest(c.req.raw)
  const upstream = new URL(`https://dash.cloudflare.com/oauth2/auth`)
  upstream.searchParams.set('client_id', c.env.CF_CLIENT_ID)
  upstream.searchParams.set('redirect_uri', new URL('/oauth/callback', c.req.url).href)
  upstream.searchParams.set('scope', 'account:read user:read offline_access')
  upstream.searchParams.set('state', btoa(JSON.stringify(oauthReqInfo)))
  upstream.searchParams.set('response_type', 'code')
  return Response.redirect(upstream.href)
})

app.get('/oauth/callback', async (c) => {
  const { code, scope, state } = c.req.query()

  if (!code) {
    return new Response('Missing code', { status: 400 })
  }
  if (!scope) {
    return new Response('Missing scope', { status: 400 })
  }
  if (!state) {
    return new Response('Missing state', { status: 400 })
  }

  const oauthReqInfo = JSON.parse(atob(state))
  const credentials = btoa(`${c.env.CF_CLIENT_ID}:${c.env.CF_CLIENT_SECRET}`)

  const resp = await fetch(`https://dash.cloudflare.com/oauth2/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${credentials}`,
    },
    body: new URLSearchParams({
      // client_id: c.env.CF_CLIENT_ID,
      // client_secret: c.env.CF_CLIENT_SECRET,
      grant_type: 'authorization_code',
      code,
      redirect_uri: new URL('/oauth/callback', c.req.url).href,
    }).toString(),
  })
  if (!resp.ok) {
    console.log(await resp.text())
    return c.text('Failed to fetch access token', 500)
  }
  const body = (await resp.json()) as Record<string, string>

  const accessToken = body.access_token
  if (!accessToken) {
    return c.text('Missing access token', 400)
  }

  // Fetch the user info from GitHub
  const apiRes = await fetch(`https://api.cloudflare.com/client/v4/user`, {
    headers: {
      Authorization: `bearer ${accessToken}`,
    },
  })
  if (!apiRes.ok) {
    console.log(await apiRes.text())
    return c.text('Failed to fetch user', 500)
  }

  const user = (await apiRes.json()) as { result: Record<string, string> }
  const { username, email } = user.result
  // Return back to the MCP client a new token
  const { redirectTo } = await c.env.OAUTH_PROVIDER.completeAuthorization({
    request: oauthReqInfo,
    userId: username,
    metadata: {
      label: email,
    },
    scope: oauthReqInfo.scope,
    // This will be available on this.props inside MyMCP
    props: {
      username,
      email,
      token: body,
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
