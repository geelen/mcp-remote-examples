import { DurableObject } from 'cloudflare:workers'

import { Hono } from 'hono'
import { html } from 'hono/html'
import { marked } from 'marked'

/** A Durable Object's behavior is defined in an exported Javascript class */
export class MyDurableObject extends DurableObject<Env> {
  /**
   * The constructor is invoked once upon creation of the Durable Object, i.e. the first call to
   * 	`DurableObjectStub::get` for a given identifier (no-op constructors can be omitted)
   *
   * @param ctx - The interface for interacting with Durable Object state
   * @param env - The interface to reference bindings declared in wrangler.jsonc
   */
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
  }

  /**
   * The Durable Object exposes an RPC method sayHello which will be invoked when when a Durable
   *  Object instance receives a request from a Worker via the same method invocation on the stub
   *
   * @param name - The name provided to a Durable Object instance from a Worker
   * @returns The greeting to be sent back to the Worker
   */
  async sayHello(name: string): Promise<string> {
    return `Hello, ${name}!`
  }
}

type Bindings = {}
type Variables = {
  isLoggedIn: boolean
}

const app = new Hono<{
  Bindings: Bindings
  Variables: Variables
}>()

// Middleware to check login status (placeholder using random)
app.use('*', async (c, next) => {
  const isLoggedIn = Math.random() > 0.5
  c.set('isLoggedIn', isLoggedIn)
  await next()
})

// Helper to generate the layout
const layout = (content: string, title: string, isLoggedIn: boolean) => html`
  <!DOCTYPE html>
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>${title}</title>
      <script src="https://cdn.tailwindcss.com"></script>
      <script>
        tailwind.config = {
          theme: {
            extend: {
              colors: {
                primary: '#3498db',
                secondary: '#2ecc71',
                accent: '#f39c12',
              },
              fontFamily: {
                sans: ['Inter', 'system-ui', 'sans-serif'],
                heading: ['Roboto', 'system-ui', 'sans-serif'],
              },
            },
          },
        }
      </script>
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Roboto:wght@400;500;700&display=swap');
      </style>
    </head>
    <body class="bg-gray-50 text-gray-800 min-h-screen font-sans leading-relaxed">
      <header class="bg-white shadow-sm mb-8">
        <div class="container mx-auto px-4 py-4 flex justify-between items-center">
          <a href="/" class="text-xl font-heading font-bold text-primary hover:text-primary/80 transition-colors">BrightApp</a>
          <div>
            ${isLoggedIn
              ? html`<span class="px-4 py-2 bg-green-100 text-green-800 rounded-md">Logged in</span>`
              : html`<a
                  href="/register"
                  class="px-4 py-2 bg-primary text-white rounded-md hover:bg-primary/90 transition-colors font-medium"
                  >Login</a
                >`}
          </div>
        </div>
      </header>
      <main class="container mx-auto px-4 pb-12">${content}</main>
      <footer class="bg-gray-100 py-6 mt-12">
        <div class="container mx-auto px-4 text-center text-gray-600">
          <p>&copy; ${new Date().getFullYear()} BrightApp. All rights reserved.</p>
        </div>
      </footer>
    </body>
  </html>
`

// Homepage content as Markdown
const homeMarkdown = `
# Welcome to BrightApp

A professional, cheerful platform for all your needs.

## What We Offer

Our platform provides seamless integration with various services while maintaining the highest standards of security and user experience.

We believe in simplicity and efficiency. [Learn more](/about) about our philosophy or [register now](/register) to get started.

> "The best way to predict the future is to create it." — Peter Drucker
`

// Route: Homepage
app.get('/', (c) => {
  const isLoggedIn = c.get('isLoggedIn')
  const content = html` <div class="prose prose-lg max-w-none">${html([marked(homeMarkdown)])}</div> `
  return c.html(layout(content, 'BrightApp - Home', isLoggedIn))
})

// Route: Register/OAuth
app.get('/register', (c) => {
  const isLoggedIn = c.get('isLoggedIn')

  const oauthScopes = [
    { name: 'read_profile', description: 'Read your basic profile information' },
    { name: 'read_data', description: 'Access your stored data' },
    { name: 'write_data', description: 'Create and modify your data' },
  ]

  const content = html`
    <div class="max-w-md mx-auto bg-white p-8 rounded-lg shadow-md">
      <h1 class="text-2xl font-heading font-bold mb-6 text-gray-900">Authorization Request</h1>

      <div class="mb-8">
        <h2 class="text-lg font-semibold mb-3 text-gray-800">BrightApp would like permission to:</h2>
        <ul class="space-y-2">
          ${oauthScopes.map(
            (scope) => html`
              <li class="flex items-start">
                <span class="inline-block mr-2 mt-1 text-secondary">✓</span>
                <div>
                  <p class="font-medium">${scope.name}</p>
                  <p class="text-gray-600 text-sm">${scope.description}</p>
                </div>
              </li>
            `,
          )}
        </ul>
      </div>

      ${isLoggedIn
        ? html`
            <form action="/approve" method="POST" class="space-y-4">
              <button
                type="submit"
                name="action"
                value="approve"
                class="w-full py-3 px-4 bg-secondary text-white rounded-md font-medium hover:bg-secondary/90 transition-colors"
              >
                Approve
              </button>
              <button
                type="submit"
                name="action"
                value="reject"
                class="w-full py-3 px-4 border border-gray-300 text-gray-700 rounded-md font-medium hover:bg-gray-50 transition-colors"
              >
                Reject
              </button>
            </form>
          `
        : html`
            <form action="/approve" method="POST" class="space-y-4">
              <div class="space-y-4">
                <div>
                  <label for="email" class="block text-sm font-medium text-gray-700 mb-1">Email</label>
                  <input
                    type="email"
                    id="email"
                    name="email"
                    required
                    class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary"
                  />
                </div>
                <div>
                  <label for="password" class="block text-sm font-medium text-gray-700 mb-1">Password</label>
                  <input
                    type="password"
                    id="password"
                    name="password"
                    required
                    class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary"
                  />
                </div>
              </div>
              <button
                type="submit"
                name="action"
                value="login_approve"
                class="w-full py-3 px-4 bg-primary text-white rounded-md font-medium hover:bg-primary/90 transition-colors"
              >
                Log in and Approve
              </button>
              <button
                type="submit"
                name="action"
                value="reject"
                class="w-full py-3 px-4 border border-gray-300 text-gray-700 rounded-md font-medium hover:bg-gray-50 transition-colors"
              >
                Reject
              </button>
            </form>
          `}
    </div>
  `

  return c.html(layout(content, 'BrightApp - Authorization', isLoggedIn))
})

// Route: Approve (POST)
app.post('/approve', async (c) => {
  const body = await c.req.parseBody()
  const action = body.action as string

  console.log('Approval route called:', {
    action,
    isLoggedIn: c.get('isLoggedIn'),
    body,
  })

  let message = ''
  let status = ''

  if (action === 'approve' || action === 'login_approve') {
    message = 'Authorization approved!'
    status = 'success'
  } else {
    message = 'Authorization rejected.'
    status = 'error'
  }

  const content = html`
    <div class="max-w-md mx-auto bg-white p-8 rounded-lg shadow-md text-center">
      <div class="mb-4">
        <span class="inline-block p-3 ${status === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'} rounded-full">
          ${status === 'success' ? '✓' : '✗'}
        </span>
      </div>
      <h1 class="text-2xl font-heading font-bold mb-4 text-gray-900">${message}</h1>
      <p class="mb-8 text-gray-600">You will be redirected back to the application shortly.</p>
      <a href="/" class="inline-block py-2 px-4 bg-primary text-white rounded-md font-medium hover:bg-primary/90 transition-colors">
        Return to Home
      </a>
    </div>
  `

  return c.html(layout(content, 'BrightApp - Authorization Status', c.get('isLoggedIn')))
})

export default app
