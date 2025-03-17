#!/usr/bin/env node

// sse-auth-proxy.ts - MCP Proxy with OAuth support
// Run with: npx tsx sse-auth-proxy.ts https://example.remote/server [callback-port]

import express from 'express'
import open from 'open'
import fs from 'fs/promises'
import path from 'path'
import crypto from 'crypto'
import { EventEmitter } from 'events'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { OAuthClientProvider, auth, UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js'
import {
  OAuthClientInformation,
  OAuthClientInformationFull,
  OAuthClientInformationSchema,
  OAuthTokens,
  OAuthTokensSchema,
} from '@modelcontextprotocol/sdk/shared/auth.js'
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import os from 'os'

// Implement OAuth client provider for Node.js environment
class NodeOAuthClientProvider implements OAuthClientProvider {
  private configDir: string
  private serverUrlHash: string

  constructor(
    private serverUrl: string,
    private callbackPort: number = 3334,
    private callbackPath: string = '/oauth/callback',
  ) {
    this.serverUrlHash = crypto.createHash('md5').update(serverUrl).digest('hex')
    this.configDir = path.join(os.homedir(), '.mcp-auth')
  }

  get redirectUrl(): string {
    return `http://localhost:${this.callbackPort}${this.callbackPath}`
  }

  get clientMetadata() {
    return {
      redirect_uris: [this.redirectUrl],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      client_name: 'MCP CLI Proxy',
      client_uri: 'https://github.com/modelcontextprotocol/mcp-cli',
    }
  }

  private async ensureConfigDir() {
    try {
      await fs.mkdir(this.configDir, { recursive: true })
    } catch (error) {
      console.error('Error creating config directory:', error)
      throw error
    }
  }

  private async readFile<T>(filename: string, schema: any): Promise<T | undefined> {
    try {
      await this.ensureConfigDir()
      const filePath = path.join(this.configDir, `${this.serverUrlHash}_${filename}`)
      const content = await fs.readFile(filePath, 'utf-8')
      return await schema.parseAsync(JSON.parse(content))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return undefined
      }
      return undefined
    }
  }

  private async writeFile(filename: string, data: any) {
    try {
      await this.ensureConfigDir()
      const filePath = path.join(this.configDir, `${this.serverUrlHash}_${filename}`)
      await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8')
    } catch (error) {
      console.error(`Error writing ${filename}:`, error)
      throw error
    }
  }

  private async writeTextFile(filename: string, text: string) {
    try {
      await this.ensureConfigDir()
      const filePath = path.join(this.configDir, `${this.serverUrlHash}_${filename}`)
      await fs.writeFile(filePath, text, 'utf-8')
    } catch (error) {
      console.error(`Error writing ${filename}:`, error)
      throw error
    }
  }

  private async readTextFile(filename: string): Promise<string> {
    try {
      await this.ensureConfigDir()
      const filePath = path.join(this.configDir, `${this.serverUrlHash}_${filename}`)
      return await fs.readFile(filePath, 'utf-8')
    } catch (error) {
      throw new Error('No code verifier saved for session')
    }
  }

  async clientInformation(): Promise<OAuthClientInformation | undefined> {
    return this.readFile<OAuthClientInformation>('client_info.json', OAuthClientInformationSchema)
  }

  async saveClientInformation(clientInformation: OAuthClientInformationFull): Promise<void> {
    await this.writeFile('client_info.json', clientInformation)
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    return this.readFile<OAuthTokens>('tokens.json', OAuthTokensSchema)
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    await this.writeFile('tokens.json', tokens)
  }

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    console.error(`\nPlease authorize this client by visiting:\n${authorizationUrl.toString()}\n`)
    try {
      await open(authorizationUrl.toString())
      console.error('Browser opened automatically.')
    } catch (error) {
      console.error('Could not open browser automatically. Please copy and paste the URL above into your browser.')
    }
  }

  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    await this.writeTextFile('code_verifier.txt', codeVerifier)
  }

  async codeVerifier(): Promise<string> {
    return await this.readTextFile('code_verifier.txt')
  }
}

// Function to proxy messages between two transports
function mcpProxy({ transportToClient, transportToServer }: { transportToClient: Transport; transportToServer: Transport }) {
  let transportToClientClosed = false
  let transportToServerClosed = false

  transportToClient.onmessage = (message) => {
    console.error('[Local→Remote]', message.method || message.id)
    transportToServer.send(message).catch(onServerError)
  }

  transportToServer.onmessage = (message) => {
    console.error('[Remote→Local]', message.method || message.id)
    transportToClient.send(message).catch(onClientError)
  }

  transportToClient.onclose = () => {
    if (transportToServerClosed) {
      return
    }

    transportToClientClosed = true
    transportToServer.close().catch(onServerError)
  }

  transportToServer.onclose = () => {
    if (transportToClientClosed) {
      return
    }
    transportToServerClosed = true
    transportToClient.close().catch(onClientError)
  }

  transportToClient.onerror = onClientError
  transportToServer.onerror = onServerError

  function onClientError(error: Error) {
    console.error('Error from local client:', error)
  }

  function onServerError(error: Error) {
    console.error('Error from remote server:', error)
  }
}

// Main function to run the proxy
async function runProxy(serverUrl: string, callbackPort: number) {
  // Set up event emitter for auth flow
  const events = new EventEmitter()

  // Create the OAuth client provider
  const authProvider = new NodeOAuthClientProvider(serverUrl, callbackPort)

  // Create the STDIO transport
  const localTransport = new StdioServerTransport()

  // Set up an HTTP server to handle OAuth callback
  let authCode: string | null = null
  const app = express()

  app.get('/oauth/callback', (req, res) => {
    const code = req.query.code as string | undefined
    if (!code) {
      res.status(400).send('Error: No authorization code received')
      return
    }

    authCode = code
    res.send('Authorization successful! You may close this window and return to the CLI.')

    // Notify main flow that auth code is available
    events.emit('auth-code-received', code)
  })

  const httpServer = app.listen(callbackPort, () => {
    console.error(`OAuth callback server running at http://localhost:${callbackPort}`)
  })

  // Function to wait for auth code
  const waitForAuthCode = (): Promise<string> => {
    return new Promise((resolve) => {
      if (authCode) {
        resolve(authCode)
        return
      }

      events.once('auth-code-received', (code) => {
        resolve(code)
      })
    })
  }

  // Function to create and connect to remote server, handling auth
  const connectToRemoteServer = async (): Promise<SSEClientTransport> => {
    console.error('Connecting to remote server:', serverUrl)
    const url = new URL(serverUrl)
    const transport = new SSEClientTransport(url, { authProvider })

    try {
      await transport.start()
      console.error('Connected to remote server')
      return transport
    } catch (error) {
      if (error instanceof UnauthorizedError || (error instanceof Error && error.message.includes('Unauthorized'))) {
        console.error('Authentication required. Waiting for authorization...')

        // Wait for the authorization code from the callback
        const code = await waitForAuthCode()

        try {
          console.error('Completing authorization...')
          await transport.finishAuth(code)

          // Create a new transport after auth
          const newTransport = new SSEClientTransport(url, { authProvider })
          await newTransport.start()
          console.error('Connected to remote server after authentication')
          return newTransport
        } catch (authError) {
          console.error('Authorization error:', authError)
          throw authError
        }
      } else {
        console.error('Connection error:', error)
        throw error
      }
    }
  }

  try {
    // Start local server
    // await server.connect(serverTransport)

    // Connect to remote server
    const remoteTransport = await connectToRemoteServer()

    // Set up bidirectional proxy
    mcpProxy({
      transportToClient: localTransport,
      transportToServer: remoteTransport,
    })

    await localTransport.start()
    console.error('Local STDIO server running')

    console.error('Proxy established successfully')
    console.error('Press Ctrl+C to exit')

    // Handle shutdown
    process.on('SIGINT', async () => {
      console.error('\nShutting down proxy...')
      await remoteTransport.close()
      await localTransport.close()
      httpServer.close()
      process.exit(0)
    })

    // Keep the process alive
    process.stdin.resume()
  } catch (error) {
    console.error('Fatal error:', error)
    httpServer.close()
    process.exit(1)
  }
}

// Parse command-line arguments
const args = process.argv.slice(2)
const serverUrl = args[0]
const callbackPort = args[1] ? parseInt(args[1]) : 3334

if (!serverUrl || !serverUrl.startsWith('https://')) {
  console.error('Usage: npx tsx sse-auth-proxy.ts <https://server-url> [callback-port]')
  process.exit(1)
}

runProxy(serverUrl, callbackPort).catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
