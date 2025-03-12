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

## 