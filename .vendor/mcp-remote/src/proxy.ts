#!/usr/bin/env node

/**
 * MCP Proxy with OAuth support
 * A bidirectional proxy between a local STDIO MCP server and a remote SSE server with OAuth authentication.
 *
 * Run with: npx tsx proxy.ts https://example.remote/server [callback-port]
 *
 * If callback-port is not specified, an available port will be automatically selected.
 */

import { EventEmitter } from 'events'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  NodeOAuthClientProvider,
  setupOAuthCallbackServer,
  connectToRemoteServer,
  mcpProxy,
  parseCommandLineArgs,
  setupSignalHandlers,
} from './shared.js'

/**
 * Main function to run the proxy
 */
async function runProxy(serverUrl: string, callbackPort: number) {
  // Set up event emitter for auth flow
  const events = new EventEmitter()

  // Create the OAuth client provider
  const authProvider = new NodeOAuthClientProvider({
    serverUrl,
    callbackPort,
    clientName: 'MCP CLI Proxy',
  })

  // Create the STDIO transport for local connections
  const localTransport = new StdioServerTransport()

  // Set up an HTTP server to handle OAuth callback
  const { server, waitForAuthCode } = setupOAuthCallbackServer({
    port: callbackPort,
    path: '/oauth/callback',
    events,
  })

  try {
    // Connect to remote server with authentication
    const remoteTransport = await connectToRemoteServer(serverUrl, authProvider, waitForAuthCode)

    // Set up bidirectional proxy between local and remote transports
    mcpProxy({
      transportToClient: localTransport,
      transportToServer: remoteTransport,
    })

    // Start the local STDIO server
    await localTransport.start()
    console.error('Local STDIO server running')
    console.error('Proxy established successfully between local STDIO and remote SSE')
    console.error('Press Ctrl+C to exit')

    // Setup cleanup handler
    const cleanup = async () => {
      await remoteTransport.close()
      await localTransport.close()
      server.close()
    }
    setupSignalHandlers(cleanup)
  } catch (error) {
    console.error('Fatal error:', error)
    server.close()
    process.exit(1)
  }
}

// Parse command-line arguments and run the proxy
parseCommandLineArgs(process.argv.slice(2), 3334, 'Usage: npx tsx proxy.ts <https://server-url> [callback-port]')
  .then(({ serverUrl, callbackPort }) => {
    return runProxy(serverUrl, callbackPort)
  })
  .catch((error) => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
