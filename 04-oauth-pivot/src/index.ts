import OAuthProvider, { AuthRequest, OAuthHelpers } from 'workers-oauth-provider'
import { MCPEntrypoint } from 'mcp-entrypoint'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { Hono } from 'hono'
import pick from 'just-pick'
import { Octokit } from 'octokit'
import { fetchUpstreamAuthToken, getUpstreamAuthorizeUrl } from './utils'

// Context from the auth process, encrypted & stored in the auth token
// and provided to the MCP Server as this.props
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
      return { content: [{ type: 'text', text: JSON.stringify(await octokit.rest.users.getAuthenticated()) }] }
    })
    return server
  }
}

const app = new Hono<{ Bindings: Env & { OAUTH_PROVIDER: OAuthHelpers } }>()

/**
 * OAuth Authorization Endpoint
 *
 * This route initiates the GitHub OAuth flow when a user wants to log in.
 * It creates a random state parameter to prevent CSRF attacks and stores the
 * original OAuth request information in KV storage for later retrieval.
 * Then it redirects the user to GitHub's authorization page with the appropriate
 * parameters so the user can authenticate and grant permissions.
 */
app.get('/authorize', async (c) => {
  const oauthReqInfo = await c.env.OAUTH_PROVIDER.parseAuthRequest(c.req.raw)
  if (!oauthReqInfo.clientId) {
    return c.text('Invalid request', 400)
  }

  return Response.redirect(
    getUpstreamAuthorizeUrl({
      upstream_url: `https://github.com/login/oauth/authorize`,
      scope: 'read:user',
      client_id: c.env.GITHUB_CLIENT_ID,
      redirect_uri: new URL('/callback', c.req.url).href,
      state: btoa(JSON.stringify(oauthReqInfo)),
    }),
  )
})

/**
 * OAuth Callback Endpoint
 *
 * This route handles the callback from GitHub after user authentication.
 * It exchanges the temporary code for an access token, then stores some
 * user metadata & the auth token as part of the 'props' on the token passed
 * down to the client. It ends by redirecting the client back to _its_ callback URL
 */
app.get('/callback', async (c) => {
  // Get the oathReqInfo out of KV
  const oauthReqInfo = JSON.parse(atob(c.req.query('state') as string)) as AuthRequest
  if (!oauthReqInfo.clientId) {
    return c.text('Invalid state', 400)
  }

  // Exchange the code for an access token
  const [accessToken, errResponse] = await fetchUpstreamAuthToken({
    upstream_url: `https://github.com/login/oauth/access_token`,
    client_id: c.env.GITHUB_CLIENT_ID,
    client_secret: c.env.GITHUB_CLIENT_SECRET,
    code: c.req.query('code'),
    redirect_uri: new URL('/callback', c.req.url).href,
  })
  if (errResponse) return errResponse

  // Fetch the user info from GitHub
  const user = await new Octokit({ auth: accessToken }).rest.users.getAuthenticated()
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
