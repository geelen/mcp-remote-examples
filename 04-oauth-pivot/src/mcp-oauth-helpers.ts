import type { ClientInfo } from '@cloudflare/workers-oauth-provider'

/**
 * Sanitizes HTML content to prevent XSS attacks
 * @param unsafe - The unsafe string that might contain HTML
 * @returns A safe string with HTML special characters escaped
 */
function sanitizeHtml(unsafe: string): string {
  return unsafe.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;')
} /**
 * Utility to encode and sign data for cookie storage
 * @param data - Data to encode and sign
 * @param secret - Secret key for signing
 * @returns Encoded and signed string
 */
async function encodeAndSign(data: any, secret: Uint8Array): Promise<string> {
  const jsonData = JSON.stringify(data)
  const encodedData = btoa(jsonData)

  const signature = await createHmacSignature(encodedData, secret)

  return `${encodedData}.${signature}`
}

/**
 * Utility to verify and decode signed data
 * @param signedData - Encoded and signed string
 * @param secret - Secret key for verification
 * @returns Decoded data if signature is valid, null otherwise
 */
async function verifyAndDecode(signedData: string, secret: Uint8Array): Promise<any | null> {
  try {
    const [encodedData, signature] = signedData.split('.')

    if (!encodedData || !signature) {
      return null
    }

    const isValid = await verifyHmacSignature(encodedData, signature, secret)

    if (!isValid) {
      return null
    }

    const jsonData = atob(encodedData)
    return JSON.parse(jsonData)
  } catch (e) {
    return null
  }
} /**
 * Utility library for OAuth pre-approval flows in Cloudflare Workers
 * Provides functionality for displaying and processing approval dialogs
 * and managing approval state via secure cookies.
 */

// Static HMAC key for cookie signing
// Uses a fixed array of 32 bytes for optimal performance and security
const COOKIE_SIGNING_KEY = new Uint8Array([
  0x3a, 0x4b, 0x12, 0x98, 0x5d, 0xf2, 0xe3, 0x7d, 0x91, 0x81, 0xfb, 0x28, 0x96, 0x6c, 0x35, 0xa7, 0x93, 0x29, 0xeb, 0x96, 0x39, 0xbf, 0xcf,
  0x75, 0xc6, 0x2e, 0x5a, 0xe9, 0x86, 0xdb, 0xbb, 0x53,
])

/**
 * Configuration for the approval dialog
 */
export interface ApprovalDialogOptions {
  /**
   * Client information to display in the approval dialog
   */
  client: ClientInfo | null
  /**
   * Server information to display in the approval dialog
   */
  server: {
    name: string
    logo?: string
    description?: string
  }
  /**
   * Arbitrary state data to pass through the approval flow
   * Will be encoded in the form and returned when approval is complete
   */
  state: Record<string, any>
  /**
   * Name of the cookie to use for storing approvals
   * @default "mcp_approved_clients"
   */
  cookieName?: string
  /**
   * Secret used to sign cookies for verification
   * Can be a string or Uint8Array
   * @default Built-in Uint8Array key
   */
  cookieSecret?: string | Uint8Array
  /**
   * Cookie domain
   * @default current domain
   */
  cookieDomain?: string
  /**
   * Cookie path
   * @default "/"
   */
  cookiePath?: string
  /**
   * Cookie max age in seconds
   * @default 30 days
   */
  cookieMaxAge?: number
}

/**
 * Result of parsing a redirect approval
 */
export interface ParsedRedirectApproval {
  /**
   * Extracted state data from the form
   */
  state: Record<string, any>
  /**
   * Headers to include in the response, including Set-Cookie
   */
  headers: Record<string, string>
}

/**
 * Creates a proper HMAC signature using the Web Crypto API
 * @param data - Data to sign
 * @param key - Key to use for signing
 * @returns Base64-encoded signature
 */
async function createHmacSignature(data: string, key: Uint8Array): Promise<string> {
  // Import the key
  const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])

  // Create the signature
  const encoder = new TextEncoder()
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(data))

  // Convert to base64
  return btoa(String.fromCharCode(...new Uint8Array(signature)))
}

/**
 * Verifies a HMAC signature using the Web Crypto API
 * @param data - Data that was signed
 * @param signature - Base64-encoded signature to verify
 * @param key - Key to use for verification
 * @returns True if signature is valid, false otherwise
 */
async function verifyHmacSignature(data: string, signature: string, key: Uint8Array): Promise<boolean> {
  try {
    // Import the key
    const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'])

    // Decode the signature
    const signatureArray = new Uint8Array(
      atob(signature)
        .split('')
        .map((c) => c.charCodeAt(0)),
    )

    // Verify the signature
    const encoder = new TextEncoder()
    return await crypto.subtle.verify('HMAC', cryptoKey, signatureArray, encoder.encode(data))
  } catch (e) {
    return false
  }
}

/**
 * Gets the cookie secret, prioritizing explicitly provided secret over the hard-coded key
 * @param providedSecret - Explicitly provided secret
 * @returns The secret to use for cookie signing
 */
function getCookieSecret(providedSecret?: string | Uint8Array): Uint8Array {
  // Use explicitly provided secret if available
  if (providedSecret) {
    // Convert string secrets to Uint8Array if needed
    if (typeof providedSecret === 'string') {
      return new TextEncoder().encode(providedSecret)
    }
    return providedSecret
  }

  // Otherwise use the hard-coded key
  return COOKIE_SIGNING_KEY
}

/**
 * Gets the value of a cookie by name
 * @param request - The HTTP request
 * @param name - Name of the cookie
 * @returns The cookie value, or null if not found
 */
function getCookie(request: Request, name: string): string | null {
  const cookies = request.headers.get('cookie')
  if (!cookies) return null

  const match = cookies.match(new RegExp(`(^| )${name}=([^;]+)`))
  return match ? match[2] : null
}

/**
 * Checks if a clientId has already been approved by the user
 * Uses a signed cookie to store approved clientIds
 *
 * @param request - The HTTP request
 * @param clientId - The client ID to check
 * @param options - Optional configuration
 * @param options.cookieName - Name of the cookie to check (default: "mcp_approved_clients")
 * @param options.cookieSecret - Secret used to verify cookie signature (string or Uint8Array)
 * @returns True if the clientId has already been approved, false otherwise
 */
export async function clientIdAlreadyApproved(
  request: Request,
  clientId: string,
  options: {
    cookieName?: string
    cookieSecret?: string | Uint8Array
  } = {},
): Promise<boolean> {
  const cookieName = options.cookieName || 'mcp_approved_clients'
  const cookieSecret = getCookieSecret(options.cookieSecret)

  // Get and verify the cookie
  const cookie = getCookie(request, cookieName)
  if (!cookie) return false

  const approvedClients = await verifyAndDecode(cookie, cookieSecret)
  if (!approvedClients || !Array.isArray(approvedClients)) return false

  // Check if the clientId is in the list of approved clients
  return approvedClients.includes(clientId)
}

/**
 * Renders an approval dialog for OAuth authorization
 * The dialog displays information about the client and server
 * and includes a form to submit approval
 *
 * @param request - The HTTP request
 * @param options - Configuration for the approval dialog
 * @returns A Response containing the HTML approval dialog
 */
export function renderApprovalDialog(request: Request, options: ApprovalDialogOptions): Response {
  const { client, server, state } = options

  // Encode state for form submission
  const encodedState = btoa(JSON.stringify(state))

  // Sanitize any untrusted content
  const serverName = sanitizeHtml(server.name)
  const clientName = client?.clientName ? sanitizeHtml(client.clientName) : 'Unknown Application'
  const clientId = client?.clientId ? sanitizeHtml(client.clientId) : 'Unknown'
  const serverDescription = server.description ? sanitizeHtml(server.description) : ''

  // Safe URLs
  const logoUrl = server.logo ? sanitizeHtml(server.logo) : ''
  const clientUri = client?.clientUri ? sanitizeHtml(client.clientUri) : ''
  const policyUri = client?.policyUri ? sanitizeHtml(client.policyUri) : ''
  const tosUri = client?.tosUri ? sanitizeHtml(client.tosUri) : ''

  // Client contacts
  const contacts = client?.contacts && client.contacts.length > 0 ? sanitizeHtml(client.contacts.join(', ')) : ''

  // Generate HTML for the approval dialog
  const htmlContent = `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Authorize Application | ${serverName}</title>
        <style>
          /* Modern, responsive styling with system fonts */
          :root {
            --primary-color: #0070f3;
            --error-color: #f44336;
            --border-color: #e5e7eb;
            --text-color: #333;
            --background-color: #fff;
            --card-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
          }
          
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, 
                         Helvetica, Arial, sans-serif, "Apple Color Emoji", 
                         "Segoe UI Emoji", "Segoe UI Symbol";
            line-height: 1.6;
            color: var(--text-color);
            background-color: #f9fafb;
            margin: 0;
            padding: 0;
          }
          
          .container {
            max-width: 600px;
            margin: 2rem auto;
            padding: 1rem;
          }
          
          .card {
            background-color: var(--background-color);
            border-radius: 8px;
            box-shadow: var(--card-shadow);
            padding: 2rem;
          }
          
          .header {
            display: flex;
            align-items: center;
            margin-bottom: 1.5rem;
          }
          
          .logo {
            width: 48px;
            height: 48px;
            margin-right: 1rem;
            border-radius: 8px;
            object-fit: contain;
          }
          
          .title {
            margin: 0;
            font-size: 1.5rem;
            font-weight: 600;
          }
          
          .description {
            margin-bottom: 1.5rem;
            color: #555;
          }
          
          .client-info {
            border: 1px solid var(--border-color);
            border-radius: 6px;
            padding: 1rem;
            margin-bottom: 1.5rem;
          }
          
          .client-name {
            font-weight: 600;
            font-size: 1.2rem;
            margin: 0 0 0.5rem 0;
          }
          
          .client-detail {
            display: flex;
            margin-bottom: 0.5rem;
          }
          
          .detail-label {
            font-weight: 500;
            min-width: 120px;
          }
          
          .actions {
            display: flex;
            justify-content: flex-end;
            gap: 1rem;
            margin-top: 2rem;
          }
          
          .button {
            padding: 0.75rem 1.5rem;
            border-radius: 6px;
            font-weight: 500;
            cursor: pointer;
            border: none;
            font-size: 1rem;
          }
          
          .button-primary {
            background-color: var(--primary-color);
            color: white;
          }
          
          .button-secondary {
            background-color: transparent;
            border: 1px solid var(--border-color);
            color: var(--text-color);
          }
          
          /* Responsive adjustments */
          @media (max-width: 640px) {
            .container {
              margin: 1rem auto;
              padding: 0.5rem;
            }
            
            .card {
              padding: 1.5rem;
            }
            
            .client-detail {
              flex-direction: column;
            }
            
            .detail-label {
              min-width: unset;
              margin-bottom: 0.25rem;
            }
            
            .actions {
              flex-direction: column;
            }
            
            .button {
              width: 100%;
            }
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="card">
            <div class="header">
              ${logoUrl ? `<img src="${logoUrl}" alt="${serverName} Logo" class="logo">` : ''}
              <h1 class="title">Authorize Application</h1>
            </div>
            
            ${serverDescription ? `<p class="description">${serverDescription}</p>` : ''}
            
            <div class="client-info">
              <h2 class="client-name">
                ${clientName}
              </h2>
              
              <div class="client-detail">
                <div class="detail-label">Client ID:</div>
                <div>${clientId}</div>
              </div>
              
              ${
                clientUri
                  ? `
                <div class="client-detail">
                  <div class="detail-label">Website:</div>
                  <div><a href="${clientUri}" target="_blank" rel="noopener noreferrer">${clientUri}</a></div>
                </div>
              `
                  : ''
              }
              
              ${
                policyUri
                  ? `
                <div class="client-detail">
                  <div class="detail-label">Privacy Policy:</div>
                  <div><a href="${policyUri}" target="_blank" rel="noopener noreferrer">View Policy</a></div>
                </div>
              `
                  : ''
              }
              
              ${
                tosUri
                  ? `
                <div class="client-detail">
                  <div class="detail-label">Terms of Service:</div>
                  <div><a href="${tosUri}" target="_blank" rel="noopener noreferrer">View Terms</a></div>
                </div>
              `
                  : ''
              }
              
              ${
                contacts
                  ? `
                <div class="client-detail">
                  <div class="detail-label">Contact:</div>
                  <div>${contacts}</div>
                </div>
              `
                  : ''
              }
            </div>
            
            <p>This application is requesting to be authorized on ${serverName}. If you approve, you will be redirected to complete authentication.</p>
            
            <form method="post" action="${new URL(request.url).pathname}">
              <input type="hidden" name="state" value="${encodedState}">
              
              <div class="actions">
                <button type="button" class="button button-secondary" onclick="window.history.back()">Cancel</button>
                <button type="submit" class="button button-primary">Approve</button>
              </div>
            </form>
          </div>
        </div>
      </body>
    </html>
  `

  return new Response(htmlContent, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
    },
  })
}

/**
 * Parses a form submission from the approval dialog
 * Extracts the state data and generates cookies to remember approval
 *
 * @param request - The HTTP request containing form data
 * @param options - Optional configuration
 * @returns Object containing the extracted state and headers to include in the response
 */
export async function parseRedirectApproval(
  request: Request,
  options: {
    cookieName?: string
    cookieSecret?: string | Uint8Array
    cookieDomain?: string
    cookiePath?: string
    cookieMaxAge?: number
  } = {},
): Promise<ParsedRedirectApproval> {
  // Parse form data
  const formData = await request.formData()
  const encodedState = formData.get('state')

  if (!encodedState || typeof encodedState !== 'string') {
    throw new Error('Invalid state data in form submission')
  }

  // Decode state
  let state: Record<string, any>
  try {
    state = JSON.parse(atob(encodedState))
  } catch (e) {
    throw new Error('Failed to decode state data')
  }

  // Extract client ID from state
  const clientId = state.oauthReqInfo?.clientId
  if (!clientId) {
    throw new Error('Missing clientId in state data')
  }

  // Configuration for cookies
  const cookieName = options.cookieName || 'mcp_approved_clients'
  const cookieSecret = getCookieSecret(options.cookieSecret)
  const cookieDomain = options.cookieDomain || undefined
  const cookiePath = options.cookiePath || '/'
  const cookieMaxAge = options.cookieMaxAge || 30 * 24 * 60 * 60 // 30 days default

  // Get existing approved clients
  const existingCookie = getCookie(request, cookieName)
  let approvedClients: string[] = []

  if (existingCookie) {
    const decodedCookie = await verifyAndDecode(existingCookie, cookieSecret)
    if (decodedCookie && Array.isArray(decodedCookie)) {
      approvedClients = decodedCookie
    }
  }

  // Add the new client ID if not already present
  if (!approvedClients.includes(clientId)) {
    approvedClients.push(clientId)
  }

  // Create signed cookie value
  const cookieValue = await encodeAndSign(approvedClients, cookieSecret)

  // Create cookie string with security settings
  const cookie = [`${cookieName}=${cookieValue}`, `Max-Age=${cookieMaxAge}`, `Path=${cookiePath}`, 'HttpOnly', 'Secure', 'SameSite=Lax']

  if (cookieDomain) {
    cookie.push(`Domain=${cookieDomain}`)
  }

  return {
    state,
    headers: {
      'Set-Cookie': cookie.join('; '),
    },
  }
}
