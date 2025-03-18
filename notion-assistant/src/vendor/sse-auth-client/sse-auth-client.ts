#!/usr/bin/env node

// sse-auth-client.ts - MCP Client with OAuth support
// Run with: npx tsx sse-auth-client.ts sse-auth-client.ts https://example.remote/server [callback-port]

import express from 'express'
import open from 'open'
import fs from 'fs/promises'
import path from 'path'
import os from 'os'
import crypto from 'crypto'
import { EventEmitter } from 'events'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { OAuthClientProvider, auth, UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js'
import { ListResourcesResultSchema, ListToolsResultSchema } from '@modelcontextprotocol/sdk/types.js'
import {
  OAuthClientInformation,
  OAuthClientInformationFull,
  OAuthClientInformationSchema,
  OAuthTokens,
  OAuthTokensSchema,
} from '@modelcontextprotocol/sdk/shared/auth.js'

// Implement OAuth client provider for Node.js environment
class NodeOAuthClientProvider implements OAuthClientProvider {
  private configDir: string
  private serverUrlHash: string

  constructor(
    private serverUrl: string,
    private callbackPort: number = 3333,
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
      client_name: 'MCP CLI Client',
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
    console.log(`\nPlease authorize this client by visiting:\n${authorizationUrl.toString()}\n`)
    try {
      await open(authorizationUrl.toString())
      console.log('Browser opened automatically.')
    } catch (error) {
      console.log('Could not open browser automatically. Please copy and paste the URL above into your browser.')
    }
  }

  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    await this.writeTextFile('code_verifier.txt', codeVerifier)
  }

  async codeVerifier(): Promise<string> {
    return await this.readTextFile('code_verifier.txt')
  }
}

// Main function to run the client
async function runClient(serverUrl: string, callbackPort: number) {
  // Set up event emitter for auth flow
  const events = new EventEmitter()

  // Create the OAuth client provider
  const authProvider = new NodeOAuthClientProvider(serverUrl, callbackPort)

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

  // Create the transport
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

  const server = app.listen(callbackPort, () => {
    console.log(`OAuth callback server running at http://localhost:${callbackPort}`)
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

  // Try to connect
  try {
    console.log('Connecting to server...')
    await client.connect(transport)
    console.log('Connected successfully!')

    // Send a resources/list request
    // console.log("Requesting resource list...");
    // const result = await client.request({ method: "resources/list" }, ListResourcesResultSchema);
    // console.log("Resources:", JSON.stringify(result, null, 2));

    console.log('Request tools list...')
    const tools = await client.request({ method: 'tools/list' }, ListToolsResultSchema)
    console.log('Tools:', JSON.stringify(tools, null, 2))

    console.log('Listening for messages. Press Ctrl+C to exit.')
  } catch (error) {
    if (error instanceof UnauthorizedError || (error instanceof Error && error.message.includes('Unauthorized'))) {
      console.log('Authentication required. Waiting for authorization...')

      // Wait for the authorization code from the callback
      const code = await waitForAuthCode()

      try {
        console.log('Completing authorization...')
        await transport.finishAuth(code)

        // Start a new transport here? Ok cause it's going to write to the file maybe?

        // Reconnect after authorization
        console.log('Connecting after authorization...')
        await client.connect(initTransport())

        console.log('Connected successfully!')

        // // Send a resources/list request
        // console.log("Requesting resource list...");
        // const result = await client.request({ method: "resources/list" }, ListResourcesResultSchema);
        // console.log("Resources:", JSON.stringify(result, null, 2));2));

        console.log('Request tools list...')
        const tools = await client.request({ method: 'tools/list' }, ListToolsResultSchema)
        console.log('Tools:', JSON.stringify(tools, null, 2))

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

  // Handle shutdown
  process.on('SIGINT', async () => {
    console.log('\nClosing connection...')
    await client.close()
    server.close()
    process.exit(0)
  })

  // Keep the process alive
  process.stdin.resume()
}

// Parse command-line arguments
const args = process.argv.slice(2)
const serverUrl = args[0]
const callbackPort = args[1] ? parseInt(args[1]) : 3333

if (!serverUrl || !serverUrl.startsWith('https://')) {
  console.error('Usage: node --experimental-strip-types sse-auth-client.ts <https://server-url> [callback-port]')
  process.exit(1)
}

runClient(serverUrl, callbackPort).catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
