# WebSockets MCP Math Demo

A reference implementation demonstrating the [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) over WebSockets using Cloudflare Workers and Durable Objects.

You can find a running version here: https://mcp-math-websockets.baselime.workers.dev/

## Overview

This repository provides a reference implementation of MCP over WebSockets. It showcases:

- A custom Websocket-based Server Transport (`src/api/websocket.ts`)
- Complete MCP client-server architecture
- Bidirectional real-time communication over WebSockets
- Tool discovery and invocation
- Deployment using Cloudflare Workers

## Development

Install dependencies:

```bash
npm install
```

Start the development server with:

```bash
npm run dev
```

Your application will be available at [http://localhost:5173](http://localhost:5173).

## Deployment

```bash
npx deploy
```

## Architecture

This project demonstrates a full MCP implementation over WebSockets with both client and server components:

```
┌─────────────────┐                 ┌─────────────────┐
│                 │                 │                 │
│  MCP Client     │◄───WebSocket───►│  MCP Server     │
│  (CF Worker)    │                 │  (CF Worker)    │
│                 │      HTTP       │                 │
└─────────────────┘───────────────► └─────────────────┘
                                        │
                                        │ State Persistence
                                        ▼
                                  ┌─────────────────┐
                                  │  Durable Object │
                                  │                 │
                                  └─────────────────┘
```

- **Client**: A Cloudflare Worker that serves the HTML/JS client application
- **Server**: A Cloudflare Worker that implements the MCP protocol with tool endpoints
- **Durable Objects**: Maintains persistent state for each agent session



