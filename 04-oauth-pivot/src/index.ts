import OAuthProvider from '@cloudflare/workers-oauth-provider'
import { McpAgent } from 'agents/mcp'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { Octokit } from 'octokit'
import { GitHubHandler } from './github-handler'
import { Props } from './utils'

const ALLOWED_USERNAMES = new Set<string>([
  // Add GitHub usernames of users who should have access to the image generation tool
  'geelen',
])

export class MyMCP extends McpAgent<Env, null, Props> {
  server = new McpServer({
    name: 'Github OAuth Proxy Demo',
    version: '1.0.0',
  })

  async init() {
    // Hello, world!
    this.server.tool('add', 'Add two numbers the way only MCP can', { a: z.number(), b: z.number() }, async ({ a, b }) => ({
      content: [{ type: 'text', text: String(a + b) }],
    }))

    // Use the upstream access token to facilitate tools
    this.server.tool('userInfoOctokit', 'Get user info from GitHub, via Octokit', {}, async () => {
      const octokit = new Octokit({ auth: this.props.accessToken })
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(await octokit.rest.users.getAuthenticated()),
          },
        ],
      }
    })

    // Dynamically add tools based on the user's login. In this case, I want to limit
    // access to my Image Generation tool to just me
    if (ALLOWED_USERNAMES.has(this.props.login)) {
      this.server.tool(
        'generateImage',
        'Generate an image using the `flux-1-schnell` model. Works best with 8 steps.',
        {
          prompt: z.string().describe('A text description of the image you want to generate.'),
          steps: z
            .number()
            .min(4)
            .max(8)
            .default(4)
            .describe(
              'The number of diffusion steps; higher values can improve quality but take longer. Must be between 4 and 8, inclusive.',
            ),
          size: z.number().default(640).describe(`The width/height of the resulting image, in pixels`),
        },
        async ({ prompt, steps, size }) => {
          const response = await this.env.AI.run('@cf/black-forest-labs/flux-1-schnell', {
            prompt,
            steps,
          })

          // Convert base64 to Uint8Array
          const imageData = Uint8Array.from(atob(response.image!), (c) => c.charCodeAt(0))

          // Create a ReadableStream from the Uint8Array using ReadableStream.from
          const imageStream = ReadableStream.from([imageData])

          // Transform the image using Cloudflare Images
          const transformedImageResponse = await (
            await this.env.IMAGES.input(imageStream).transform({ width: size }).output({ format: 'image/jpeg', quality: 80 })
          ).response()

          // Convert ArrayBuffer to base64 safely (chunked conversion to avoid stack overflow)
          const transformedImageArrayBuffer = await transformedImageResponse.arrayBuffer()
          const bytes = new Uint8Array(transformedImageArrayBuffer)
          let binary = ''
          const chunkSize = 1024
          for (let i = 0; i < bytes.byteLength; i += chunkSize) {
            const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.byteLength))
            binary += String.fromCharCode.apply(null, chunk)
          }
          const transformedImageBase64 = btoa(binary)

          return {
            content: [{ type: 'image', data: transformedImageBase64, mimeType: 'image/jpeg' }],
          }
        },
      )
    }
  }
}

export default new OAuthProvider({
  apiRoute: '/sse',
  apiHandler: MyMCP.mount('/sse'),
  defaultHandler: GitHubHandler,
  authorizeEndpoint: '/authorize',
  tokenEndpoint: '/token',
  clientRegistrationEndpoint: '/register',
})
