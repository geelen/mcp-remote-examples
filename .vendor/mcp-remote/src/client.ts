#!/usr/bin/env node

/**
 * MCP Client with OAuth support
 * A command-line client that connects to an MCP server using SSE with OAuth authentication.
 *
 * Run with: npx tsx client.ts https://example.remote/server [callback-port]
 *
 * If callback-port is not specified, an available port will be automatically selected.
 */

import { EventEmitter } from 'events'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { ListResourcesResultSchema, ListToolsResultSchema } from '@modelcontextprotocol/sdk/types.js'
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js'
import { NodeOAuthClientProvider, setupOAuthCallbackServer, parseCommandLineArgs, setupSignalHandlers } from './shared.js'

/**
 * Main function to run the client
 */
async function runClient(serverUrl: string, callbackPort: number) {
  // Set up event emitter for auth flow
  const events = new EventEmitter()

  // Create the OAuth client provider
  const authProvider = new NodeOAuthClientProvider({
    serverUrl,
    callbackPort,
    clientName: 'MCP CLI Client',
  })

  // Create the client
  const client = new Client(
    {
      name: 'mcp-cli',
      version: '0.1.0',
    },
    {
      capabilities: {
        sampling: {},
      },
    },
  )

  // Create the transport factory
  const url = new URL(serverUrl)
  function initTransport() {
    const transport = new SSEClientTransport(url, { authProvider })

    // Set up message and error handlers
    transport.onmessage = (message) => {
      console.log('Received message:', JSON.stringify(message, null, 2))
    }

    transport.onerror = (error) => {
      console.error('Transport error:', error)
    }

    transport.onclose = () => {
      console.log('Connection closed.')
      process.exit(0)
    }
    return transport
  }

  const transport = initTransport()

  // Set up an HTTP server to handle OAuth callback
  const { server, waitForAuthCode } = setupOAuthCallbackServer({
    port: callbackPort,
    path: '/oauth/callback',
    events,
  })

  // Set up cleanup handler
  const cleanup = async () => {
    console.log('\nClosing connection...')
    await client.close()
    server.close()
  }
  setupSignalHandlers(cleanup)

  // Try to connect
  try {
    console.log('Connecting to server...')
    await client.connect(transport)
    console.log('Connected successfully!')
  } catch (error) {
    if (error instanceof UnauthorizedError || (error instanceof Error && error.message.includes('Unauthorized'))) {
      console.log('Authentication required. Waiting for authorization...')

      // Wait for the authorization code from the callback
      const code = await waitForAuthCode()

      try {
        console.log('Completing authorization...')
        await transport.finishAuth(code)

        // Reconnect after authorization with a new transport
        console.log('Connecting after authorization...')
        await client.connect(initTransport())

        console.log('Connected successfully!')

        // Request tools list after auth
        console.log('Requesting tools list...')
        const tools = await client.request({ method: 'tools/list' }, ListToolsResultSchema)
        console.log('Tools:', JSON.stringify(tools, null, 2))

        // Request resources list after auth
        console.log('Requesting resource list...')
        const resources = await client.request({ method: 'resources/list' }, ListResourcesResultSchema)
        console.log('Resources:', JSON.stringify(resources, null, 2))

        console.log('Listening for messages. Press Ctrl+C to exit.')
      } catch (authError) {
        console.error('Authorization error:', authError)
        server.close()
        process.exit(1)
      }
    } else {
      console.error('Connection error:', error)
      server.close()
      process.exit(1)
    }
  }

  try {
    // Request tools list
    console.log('Requesting tools list...')
    const tools = await client.request({ method: 'tools/list' }, ListToolsResultSchema)
    console.log('Tools:', JSON.stringify(tools, null, 2))
  } catch (e) {
    console.log('Error requesting tools list:', e)
  }

  try {
    // Request resources list
    console.log('Requesting resource list...')
    const resources = await client.request({ method: 'resources/list' }, ListResourcesResultSchema)
    console.log('Resources:', JSON.stringify(resources, null, 2))
  } catch (e) {
    console.log('Error requesting resources list:', e)
  }

  console.log('Listening for messages. Press Ctrl+C to exit.')
}

// Parse command-line arguments and run the client
parseCommandLineArgs(process.argv.slice(2), 3333, 'Usage: npx tsx client.ts <https://server-url> [callback-port]')
  .then(({ serverUrl, callbackPort }) => {
    return runClient(serverUrl, callbackPort)
  })
  .catch((error) => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
