# User/Password

This is a demonstration of using `WorkersOAuthProvider` (see `.vendor`) to create a Worker that is both an OAuth 2.1 server as well as an MCP server.

You can test it out:

```
npx @modelcontextprotocol/inspector@latest
```

Then select `SSE` and try the public Worker example: `https://02-user-password.glen.workers.dev/sse`

Or, to run this repo locally and make changes:

```
pnpm install
pnpm dev
```

Then visit `http://localhost:8787/sse`

In both cases, you should be prompted with a (fake) user/password login screen. In which case, enter any user/password and hit accept.

Or, hit refresh. 50% of the time the server pretends you're already logged in and just asks for click confirmation.

## Usage

See `src/index.ts` for usage. The current (wip) API looks as follows:

```ts
export class MyMCP extends MCPEntrypoint {
  get server() {
    const server = new McpServer({
      name: 'Demo',
      version: '1.0.0',
    })
    server.tool('add', { a: z.number(), b: z.number() }, async ({ a, b }) => ({
      content: [{ type: 'text', text: String(a + b) }],
    }))
    return server
  }
}

// Export the OAuth handler as the default
export default new OAuthProvider({
  apiRoute: '/sse',
  apiHandler: MyMCP.Router,
  defaultHandler: app,
  authorizeEndpoint: '/authorize',
  tokenEndpoint: '/token',
  clientRegistrationEndpoint: '/register',
})
```

`MyMCP` is a `DurableObject` here, `MyMCP.Router` is a `WorkerEntrypoint` that can route to it. The implementation is pretty coupled to the specifics of this app (i.e. needs to know `/sse` is the API route, DO namespace is on `env.MCP_OBJECT` etc) but it's a useful first pass.
