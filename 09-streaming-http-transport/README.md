
# Stateless MCP HTTP Streamable POC

There's only 3 files here that are important here:

- `src/index.ts` - entry point to the worker and where we define the MCP Server
- `src/serve-mcp.ts` - a small function wrapper
- `src/stateless-workers-transport.ts` - where the magic happens / a stateless transport

To run: `npm run dev`

To take actions you need a client. The typescript SDK recently merged a small test script.
Run it in the MCP typescript SDK with:

```bash
npx tsx src/examples/client/simpleStreamableHttp.ts
```

```bash
❯ npx tsx src/examples/client/simpleStreamableHttp.ts
Connected to MCP server
Available tools: [
  {
    name: 'greet',
    description: 'A simple greeting tool',
    inputSchema: {
      type: 'object',
      properties: [Object],
      required: [Array],
      additionalProperties: false,
      '$schema': 'http://json-schema.org/draft-07/schema#'
    }
  }
]
Greeting result: Hello, MCP User!
Available prompts: [
  {
    name: 'greeting-template',
    description: 'A simple greeting prompt template',
    arguments: [ [Object] ]
  }
]
Prompt template: Please greet MCP User in a friendly manner.
Available resources: [
  {
    uri: 'https://example.com/greetings/default',
    name: 'greeting-resource',
    mimeType: 'text/plain'
  }
]
```

## Notes

This is a prototype of a completely stateless transport. It does not support session ids.
It is not fully tested.

The benefit over the stateful transport in `cloudflare/agents` is that it can be run in
a worker very close to the end user and will only incur cpuTime costs. The downsides are
being unable to support every optional feature of the MCP spec such as sessions, sampling,
resumability.