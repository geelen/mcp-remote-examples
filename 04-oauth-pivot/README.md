# OAuth "Pivot" MCP

This is a Workers MCP server that:

* Acts as OAuth _Server_ to your MCP clients
* Acts as OAuth _Client_ to your _real_ OAuth server (in this case, GitHub)

...and tries to make it as seamless as possible. Did we succeed? Let's find out!

## Github OAuth MCP

To try it out, run

```
npx @modelcontextprotocol/inspector@latest
```

Then enter `https://04-oauth-pivot.glen.workers.dev/sse` and hit connect. Follow the prompts, then see if the tool calls work.

The [`src/index.ts`](src/index.ts) file has three parts, the MCP server definition (iterating on the `MCPEntrypoint` API from example 02):

```ts
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
```

The second uses the `OAuthProvider` WIP library (see `.vendor` directory) to configure a spec-compliant Oauth server

```ts
export default new OAuthProvider({
  apiRoute: '/sse',
  apiHandler: MyMCP.Router,
  defaultHandler: app,
  authorizeEndpoint: '/authorize',
  tokenEndpoint: '/token',
  clientRegistrationEndpoint: '/register',
})
```

Finally, a Hono app for implementing the `authorize` and `callback` URLs. We want to pull this into another API to encapsultate the app-specific logic a bit better:

```ts

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
  // ...
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
  // ...
})
```

The demo uses Github OAuth which issues access tokens that (as far as I'm aware) don't expire (it certainly doesn't send a refresh token), which makes this a bit of a simpler test to get started. It also has some of the same caveats as example 2, e.g. `MCPEntrypoint` being a "library" but needing the worker that uses it to have a certain internal structure (e.g. `MCP_OBJECT` durable object namespace).

