// workers-oauth-utils.ts

import type { ClientInfo, AuthRequest } from '@cloudflare/workers-oauth-provider' // Adjust path if necessary

const COOKIE_NAME = 'mcp-approved-clients'
const ONE_YEAR_IN_SECONDS = 31536000

// --- Helper Functions ---

/**
 * Encodes arbitrary data to a URL-safe base64 string.
 * @param data - The data to encode (will be stringified).
 * @returns A URL-safe base64 encoded string.
 */
function encodeState(data: any): string {
  try {
    const jsonString = JSON.stringify(data)
    // Use btoa for simplicity, assuming Worker environment supports it well enough
    // For complex binary data, a Buffer/Uint8Array approach might be better
    return btoa(jsonString)
  } catch (e) {
    console.error('Error encoding state:', e)
    throw new Error('Could not encode state')
  }
}

/**
 * Decodes a URL-safe base64 string back to its original data.
 * @param encoded - The URL-safe base64 encoded string.
 * @returns The original data.
 */
function decodeState<T = any>(encoded: string): T {
  try {
    const jsonString = atob(encoded)
    return JSON.parse(jsonString)
  } catch (e) {
    console.error('Error decoding state:', e)
    throw new Error('Could not decode state')
  }
}

/**
 * Imports a secret key string for HMAC-SHA256 signing.
 * @param secret - The raw secret key string.
 * @returns A promise resolving to the CryptoKey object.
 */
async function importKey(secret: string): Promise<CryptoKey> {
  if (!secret) {
    throw new Error('COOKIE_SECRET is not defined. A secret key is required for signing cookies.')
  }
  const enc = new TextEncoder()
  return crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false, // not extractable
    ['sign', 'verify'], // key usages
  )
}

/**
 * Signs data using HMAC-SHA256.
 * @param key - The CryptoKey for signing.
 * @param data - The string data to sign.
 * @returns A promise resolving to the signature as a hex string.
 */
async function signData(key: CryptoKey, data: string): Promise<string> {
  const enc = new TextEncoder()
  const signatureBuffer = await crypto.subtle.sign('HMAC', key, enc.encode(data))
  // Convert ArrayBuffer to hex string
  return Array.from(new Uint8Array(signatureBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Verifies an HMAC-SHA256 signature.
 * @param key - The CryptoKey for verification.
 * @param signatureHex - The signature to verify (hex string).
 * @param data - The original data that was signed.
 * @returns A promise resolving to true if the signature is valid, false otherwise.
 */
async function verifySignature(key: CryptoKey, signatureHex: string, data: string): Promise<boolean> {
  const enc = new TextEncoder()
  try {
    // Convert hex signature back to ArrayBuffer
    const signatureBytes = new Uint8Array(signatureHex.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16)))
    return await crypto.subtle.verify('HMAC', key, signatureBytes.buffer, enc.encode(data))
  } catch (e) {
    // Handle errors during hex parsing or verification
    console.error('Error verifying signature:', e)
    return false
  }
}

/**
 * Parses the signed cookie and verifies its integrity.
 * @param cookieHeader - The value of the Cookie header from the request.
 * @param secret - The secret key used for signing.
 * @returns A promise resolving to the list of approved client IDs if the cookie is valid, otherwise null.
 */
async function getApprovedClientsFromCookie(cookieHeader: string | null, secret: string): Promise<string[] | null> {
  if (!cookieHeader) return null

  const cookies = cookieHeader.split(';').map((c) => c.trim())
  const targetCookie = cookies.find((c) => c.startsWith(`${COOKIE_NAME}=`))

  if (!targetCookie) return null

  const cookieValue = targetCookie.substring(COOKIE_NAME.length + 1)
  const parts = cookieValue.split('.')

  if (parts.length !== 2) {
    console.warn('Invalid cookie format received.')
    return null // Invalid format
  }

  const [signatureHex, base64Payload] = parts
  const payload = atob(base64Payload) // Assuming payload is base64 encoded JSON string

  const key = await importKey(secret)
  const isValid = await verifySignature(key, signatureHex, payload)

  if (!isValid) {
    console.warn('Cookie signature verification failed.')
    return null // Signature invalid
  }

  try {
    const approvedClients = JSON.parse(payload)
    if (!Array.isArray(approvedClients)) {
      console.warn('Cookie payload is not an array.')
      return null // Payload isn't an array
    }
    // Ensure all elements are strings
    if (!approvedClients.every((item) => typeof item === 'string')) {
      console.warn('Cookie payload contains non-string elements.')
      return null
    }
    return approvedClients as string[]
  } catch (e) {
    console.error('Error parsing cookie payload:', e)
    return null // JSON parsing failed
  }
}

// --- Exported Functions ---

/**
 * Checks if a given client ID has already been approved by the user,
 * based on a signed cookie.
 *
 * @param request - The incoming Request object to read cookies from.
 * @param clientId - The OAuth client ID to check approval for.
 * @param cookieSecret - The secret key used to sign/verify the approval cookie.
 * @returns A promise resolving to true if the client ID is in the list of approved clients in a valid cookie, false otherwise.
 */
export async function clientIdAlreadyApproved(request: Request, clientId: string, cookieSecret: string): Promise<boolean> {
  if (!clientId) return false
  const cookieHeader = request.headers.get('Cookie')
  const approvedClients = await getApprovedClientsFromCookie(cookieHeader, cookieSecret)

  return approvedClients?.includes(clientId) ?? false
}

/**
 * Options for rendering the approval dialog.
 */
export interface ApprovalDialogOptions {
  /** Information about the OAuth client requesting authorization. */
  client: ClientInfo | null
  /** Information about the MCP server presenting the dialog. */
  server: {
    name: string
    logo?: string // URL
    description?: string
  }
  /** Arbitrary state to be preserved and passed through the form submission. */
  state: any
}

/**
 * Renders an HTML approval dialog for the user.
 *
 * @param _request - The incoming Request object (currently unused, but kept for potential future use like reading Host).
 * @param options - Configuration for rendering the dialog, including client, server, and state data.
 * @returns An HTML Response object containing the approval dialog.
 */
export function renderApprovalDialog(_request: Request, options: ApprovalDialogOptions): Response {
  const { client, server, state } = options

  // Basic validation
  if (!client) {
    return new Response('Client information is missing.', { status: 400 })
  }
  if (!state) {
    return new Response('State information is missing.', { status: 400 })
  }

  const encodedState = encodeState(state)
  const clientName = client.clientName || client.clientId // Fallback to clientId if name is missing
  const clientLogo = client.logoUri
    ? `<img src="${client.logoUri}" alt="${clientName} Logo" style="max-height: 50px; max-width: 150px; margin-bottom: 1em;"/>`
    : ''
  const serverLogo = server.logo
    ? `<img src="${server.logo}" alt="${server.name} Logo" style="max-height: 30px; margin-right: 10px; vertical-align: middle;"/>`
    : ''
  const serverDescription = server.description ? `<p style="font-size: 0.9em; color: #555;">${server.description}</p>` : ''

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Authorize Application - ${server.name}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol";
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      background-color: #f4f5f7;
      margin: 0;
      color: #333;
    }
    .container {
      background-color: #fff;
      padding: 2em 3em;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
      max-width: 450px;
      width: 90%;
      text-align: center;
    }
    .server-header {
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 1em;
      padding-bottom: 1em;
      border-bottom: 1px solid #eee;
    }
    .server-header h1 {
        font-size: 1.2em;
        margin: 0;
        color: #555;
    }
    .client-info {
        margin-bottom: 1.5em;
    }
    .client-info h2 {
        font-size: 1.4em;
        margin-bottom: 0.5em;
    }
    .client-info p {
        margin-bottom: 1em;
        font-size: 1em;
        line-height: 1.5;
    }
    button {
      background-color: #007bff;
      color: white;
      border: none;
      padding: 12px 25px;
      border-radius: 5px;
      font-size: 1em;
      cursor: pointer;
      transition: background-color 0.2s ease;
    }
    button:hover {
      background-color: #0056b3;
    }
    form {
        margin-top: 1.5em;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="server-header">
        ${serverLogo}
        <h1>${server.name}</h1>
    </div>

    <div class="client-info">
      ${clientLogo}
      <h2>Authorize ${clientName}</h2>
      <p>
        The application <strong>${clientName}</strong> is requesting permission to access your account via <strong>${server.name}</strong>.
      </p>
      ${serverDescription}
    </div>

    <form method="POST">
      <input type="hidden" name="state" value="${encodedState}">
      <button type="submit">Approve</button>
      </form>
  </div>
</body>
</html>
  `

  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}

/**
 * Result of parsing the approval form submission.
 */
export interface ParsedApprovalResult {
  /** The original state object passed through the form. */
  state: any
  /** Headers to set on the redirect response, including the Set-Cookie header. */
  headers: Record<string, string>
}

/**
 * Parses the form submission from the approval dialog, extracts the state,
 * and generates Set-Cookie headers to mark the client as approved.
 *
 * @param request - The incoming POST Request object containing the form data.
 * @param cookieSecret - The secret key used to sign the approval cookie.
 * @returns A promise resolving to an object containing the parsed state and necessary headers.
 * @throws If the request method is not POST, form data is invalid, or state is missing.
 */
export async function parseRedirectApproval(request: Request, cookieSecret: string): Promise<ParsedApprovalResult> {
  if (request.method !== 'POST') {
    throw new Error('Invalid request method. Expected POST.')
  }

  let state: any
  let clientId: string | undefined

  try {
    const formData = await request.formData()
    const encodedState = formData.get('state')

    if (typeof encodedState !== 'string' || !encodedState) {
      throw new Error("Missing or invalid 'state' in form data.")
    }

    state = decodeState<{ oauthReqInfo?: AuthRequest }>(encodedState) // Decode the state
    clientId = state?.oauthReqInfo?.clientId // Extract clientId from within the state

    if (!clientId) {
      throw new Error('Could not extract clientId from state object.')
    }
  } catch (e) {
    console.error('Error processing form submission:', e)
    // Rethrow or handle as appropriate, maybe return a specific error response
    throw new Error(`Failed to parse approval form: ${e instanceof Error ? e.message : String(e)}`)
  }

  // Get existing approved clients
  const cookieHeader = request.headers.get('Cookie')
  const existingApprovedClients = (await getApprovedClientsFromCookie(cookieHeader, cookieSecret)) || []

  // Add the newly approved client ID (avoid duplicates)
  const updatedApprovedClients = Array.from(new Set([...existingApprovedClients, clientId]))

  // Sign the updated list
  const payload = JSON.stringify(updatedApprovedClients)
  const key = await importKey(cookieSecret)
  const signature = await signData(key, payload)
  const newCookieValue = `${signature}.${btoa(payload)}` // signature.base64(payload)

  // Generate Set-Cookie header
  const headers: Record<string, string> = {
    'Set-Cookie': `${COOKIE_NAME}=${newCookieValue}; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=${ONE_YEAR_IN_SECONDS}`,
  }

  return { state, headers }
}
