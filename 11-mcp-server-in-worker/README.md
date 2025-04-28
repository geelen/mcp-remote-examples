
# McpServer in Worker POC

This prototypes what a different architecture for our MCP library would look like. Instead of running
the `McpServer` within a Durable Object, this instantiates the `McpServer` within the worker and uses
the Durable Object to manage session state and to proxy messages between workers.

For SSE:

Very similar to what we have today. In `agents` when receiving an incoming message it sends the
message to the DO, where the `McpServer` lives, the `McpServer` processes the message, and the response
is forwarded on to the worker holding open the SSE stream.

In this version, the DO just proxies the message and the worker holding open the SSE stream, receives
it, processes it with its instance of the `McpServer`, and sends the response on the SSE stream.

For Streamable:

Streamable is more complicated than SSE, but this implementation is simpler than the one in `agents`.

In `agents` the DO has to maintain multiple connections and make sure that each response goes back
to the worker that the related request came in on.

Here that is flipped. The worker processes those requests directly and returns the responses directly
over its SSE stream.

Once we support holding open a GET request like in SSE, it will work similarly to the SSE transport.
The worker serving the GET request will open a websocket to the DO.

All events will get written to the DO so that we can replay them / resume connections. If they did
not get sent back to the user they should be sent over the GET-initiated SSE.

## But why?

- Reliability. In `agents` all the code that manages the connection lives and executes alongside
  user code, which we cannot control. This is likely to be difficult to make resilient to user errors.

- Simplicity. Especially with Streamable, we end up needing to manage many websocket connections. Here
  we only ever need to manage one per session.

- Cost. Running in the DO vs a worker means you end up paying for wall time for long-lived calls. The 
  Durable Objects should hibernate, but several users have ended up with surpising charges because something
  keeps them awake. This new setup should give us a lot more control over that.

## Potential Issues

This does mean we are moving from one `McpServer` instance to potentially many. I suspect that is largely
fine, but we might need to think through making the McpServer a function of some state to prevent mutable
changes meaning that the `McpServer` in the long-lived connections might be slightly different from the
instances in the short-lived workers.

## Notes

There's only 2 files here that are important here:

- `src/index.ts` - entry point to the worker and where we define the MCP Server
- `src/mcp.ts` - equivalent to `McpAgent` in `@cloudflare/agents`. This supports both SSE and Streamable transports with a similar interface

To run: `npm run dev` or `npx wrangler dev --port 3000` to use with the typescript sdk's streamable example client.

You can connect over SSE using the MCP Inspector or any available SSE client.

To take actions you need a client. The typescript SDK recently merged a small test script.
Run it in the MCP typescript SDK with:

```bash
npx tsx src/examples/client/simpleStreamableHttp.ts
```

```bash
❯ npx tsx src/examples/client/simpleStreamableHttp.ts
MCP Interactive Client
=====================
Connecting to http://localhost:3000/mcp...
Transport created with session ID: 87c07a86c2fd258ace2b1eeea2d70c961aa7866fa42518214055c013b59e022d
Connected to MCP server

Available commands:
  connect [url]              - Connect to MCP server (default: http://localhost:3000/mcp)
  disconnect                 - Disconnect from server
  terminate-session          - Terminate the current session
  reconnect                  - Reconnect to the server
  list-tools                 - List available tools
  call-tool <name> [args]    - Call a tool with optional JSON arguments
  greet [name]               - Call the greet tool
  multi-greet [name]         - Call the multi-greet tool with notifications
  start-notifications [interval] [count] - Start periodic notifications
  list-prompts               - List available prompts
  get-prompt [name] [args]   - Get a prompt with optional JSON arguments
  list-resources             - List available resources
  help                       - Show this help
  quit                       - Exit the program

> greet Bug
Calling tool 'greet' with args: { name: 'Bug' }
Tool result:
  Hello, Bug!
```

## Issues

There is an error message when connecting via Streamable

```
✘ [ERROR] A hanging Promise was canceled. This happens when the worker runtime is waiting for a Promise from JavaScript to resolve, but has detected that the Promise cannot possibly ever resolve because all code and events related to the Promise's I/O context have already finished.
```

I don't yet know what's causing this, but since it's working and this is a POC, I'm going to ignore it for now.
