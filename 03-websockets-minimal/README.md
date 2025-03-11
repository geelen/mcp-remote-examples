# Websocket MCP Server + Durable Objects

1. A Minimal Websocket Transport layer that works with `@modelcontextprotocol/typescript-sdk` (`/src/websocket.ts`)
2. A MCP Server as a Durable Object (`/src/index.ts`)
3. Steps to run it end-to-end

## Run it

1. Clone this repo
2. `npm install`
3. `npm start` to start the DO (at `http://localhost:8787`)
4. Within the [`@modelcontextprotocol/typescript-sdk` repo](https://github.com/modelcontextprotocol/typescript-sdk) run `npm install && npm run client ws://localhost:8787`

You should see:

<img width="853" alt="Screenshot 2025-03-09 at 5 21 24 PM" src="./typescript-sdk-connecting.png" />

In the logs for this server you can see the received jsonrpc messages exchanged:

```log
[wrangler:inf] GET / 101 Switching Protocols (4ms)
received message {
  jsonrpc: '2.0',
  id: 0,
  method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: { sampling: {} },
    clientInfo: { name: 'mcp-typescript test client', version: '0.1.0' }
  }
}
sending message {
  result: {
    protocolVersion: '2024-11-05',
    capabilities: { tools: {}, resources: {} },
    serverInfo: { name: 'Demo', version: '1.0.0' }
  },
  jsonrpc: '2.0',
  id: 0
}
received message { jsonrpc: '2.0', method: 'notifications/initialized' }
received message { jsonrpc: '2.0', id: 1, method: 'resources/list' }
sending message { result: { resources: [] }, jsonrpc: '2.0', id: 1 }
```

## Details

This is based around [this example](https://github.com/irvinebroque/mcp-server-do/) however I swapped the SSE transport implementation for a
minimal websocket example.
