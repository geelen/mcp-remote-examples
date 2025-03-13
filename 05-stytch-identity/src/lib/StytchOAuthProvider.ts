import type { ExportedHandler, ExecutionContext } from '@cloudflare/workers-types'
import { WorkerEntrypoint } from 'cloudflare:workers'
import {jwtVerify, createRemoteJWKSet} from 'jose'
import {JWTVerifyGetKey} from "jose/dist/types/jwt/verify";

// Types

/**
 * Enum representing the type of handler (ExportedHandler or WorkerEntrypoint)
 */
enum HandlerType {
  EXPORTED_HANDLER,
  WORKER_ENTRYPOINT,
}

/**
 * Configuration options for the OAuth Provider
 */
export interface OAuthProviderOptions {
  /**
   * URL(s) for API routes. Requests with URLs starting with any of these prefixes
   * will be treated as API requests and require a valid access token.
   * Can be a single route or an array of routes. Each route can be a full URL or just a path.
   */
  apiRoute: string | string[]

  /**
   * Handler for API requests that have a valid access token.
   * This handler will receive the authenticated user properties in ctx.props.
   * Can be either an ExportedHandler object with a fetch method or a class extending WorkerEntrypoint.
   */
  apiHandler: ExportedHandler | (new (ctx: ExecutionContext, env: any) => WorkerEntrypoint)

  /**
   * Handler for all non-API requests or API requests without a valid token.
   * Can be either an ExportedHandler object with a fetch method or a class extending WorkerEntrypoint.
   */
  defaultHandler: ExportedHandler | (new (ctx: ExecutionContext, env: any) => WorkerEntrypoint)

  /**
   * URL of the OAuth authorization endpoint where users can grant permissions.
   * This URL is used in OAuth metadata and is not handled by the provider itself.
   */
  authorizeEndpoint: string

  /**
   * URL of the token endpoint which the provider will implement.
   * This endpoint handles token issuance, refresh, and revocation.
   */
  tokenEndpoint: string

  /**
   * Optional URL for the client registration endpoint.
   * If provided, the provider will implement dynamic client registration.
   */
  clientRegistrationEndpoint?: string

  /**
   * List of scopes supported by this OAuth provider.
   * If not provided, the 'scopes_supported' field will be omitted from the OAuth metadata.
   */
  scopesSupported?: string[]
}

/**
 * OAuth 2.0 Provider implementation for Cloudflare Workers
 * Implements authorization code flow with support for refresh tokens
 * and dynamic client registration.
 */
export class StytchOAuthProvider {
  #impl: StytchOAuthProviderImpl

  /**
   * Creates a new OAuth provider instance
   * @param options - Configuration options for the provider
   */
  constructor(options: OAuthProviderOptions) {
    this.#impl = new StytchOAuthProviderImpl(options)
  }

  /**
   * Main fetch handler for the Worker
   * Routes requests to the appropriate handler based on the URL
   * @param request - The HTTP request
   * @param env - Cloudflare Worker environment variables
   * @param ctx - Cloudflare Worker execution context
   * @returns A Promise resolving to an HTTP Response
   */
  fetch(request: Request, env: any, ctx: ExecutionContext): Promise<Response> {
    return this.#impl.fetch(request, env, ctx)
  }
}

/**
 * Implementation class backing OAuthProvider.
 *
 * We use a PImpl pattern in `OAuthProvider` to make sure we don't inadvertently export any private
 * methods over RPC. Unfortunately, declaring a method "private" in TypeScript is merely a type
 * annotation, and does not actually prevent the method from being called from outside the class,
 * including over RPC.
 */
class StytchOAuthProviderImpl {
  /**
   * Configuration options for the provider
   */
  options: OAuthProviderOptions

  /**
   * Represents the type of a handler (ExportedHandler or WorkerEntrypoint)
   */
  private apiHandlerType: HandlerType
  private defaultHandlerType: HandlerType

  /**
   * Creates a new OAuth provider instance
   * @param options - Configuration options for the provider
   */
  constructor(options: OAuthProviderOptions) {
    // Validate and determine handler types
    this.apiHandlerType = this.validateHandler(options.apiHandler, 'apiHandler')
    this.defaultHandlerType = this.validateHandler(options.defaultHandler, 'defaultHandler')

    // Validate that the endpoints are either absolute paths or full URLs
    if (Array.isArray(options.apiRoute)) {
      options.apiRoute.forEach((route, index) => {
        this.validateEndpoint(route, `apiRoute[${index}]`)
      })
    } else {
      this.validateEndpoint(options.apiRoute, 'apiRoute')
    }
    this.validateEndpoint(options.authorizeEndpoint, 'authorizeEndpoint')
    this.validateEndpoint(options.tokenEndpoint, 'tokenEndpoint')
    if (options.clientRegistrationEndpoint) {
      this.validateEndpoint(options.clientRegistrationEndpoint, 'clientRegistrationEndpoint')
    }

    this.options = {
      ...options,
    }
  }

  /**
   * Validates that an endpoint is either an absolute path or a full URL
   * @param endpoint - The endpoint to validate
   * @param name - The name of the endpoint property for error messages
   * @throws TypeError if the endpoint is invalid
   */
  private validateEndpoint(endpoint: string, name: string): void {
    if (this.isPath(endpoint)) {
      // It should be an absolute path starting with /
      if (!endpoint.startsWith('/')) {
        throw new TypeError(`${name} path must be an absolute path starting with /`)
      }
    } else {
      // It should be a valid URL
      try {
        new URL(endpoint)
      } catch (e) {
        throw new TypeError(`${name} must be either an absolute path starting with / or a valid URL`)
      }
    }
  }

  /**
   * Validates that a handler is either an ExportedHandler or a class extending WorkerEntrypoint
   * @param handler - The handler to validate
   * @param name - The name of the handler property for error messages
   * @returns The type of the handler (EXPORTED_HANDLER or WORKER_ENTRYPOINT)
   * @throws TypeError if the handler is invalid
   */
  private validateHandler(handler: any, name: string): HandlerType {
    if (typeof handler === 'object' && handler !== null && typeof handler.fetch === 'function') {
      // It's an ExportedHandler object
      return HandlerType.EXPORTED_HANDLER
    }

    // Check if it's a class constructor extending WorkerEntrypoint
    if (typeof handler === 'function' && handler.prototype instanceof WorkerEntrypoint) {
      return HandlerType.WORKER_ENTRYPOINT
    }

    throw new TypeError(`${name} must be either an ExportedHandler object with a fetch method or a class extending WorkerEntrypoint`)
  }

  /**
   * Main fetch handler for the Worker
   * Routes requests to the appropriate handler based on the URL
   * @param request - The HTTP request
   * @param env - Cloudflare Worker environment variables
   * @param ctx - Cloudflare Worker execution context
   * @returns A Promise resolving to an HTTP Response
   */
  async fetch(request: Request, env: any, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)

    // Special handling for OPTIONS requests (CORS preflight)
    if (request.method === 'OPTIONS') {
      // For API routes and OAuth endpoints, respond with CORS headers
      if (
        this.isApiRequest(url) ||
        url.pathname === '/.well-known/oauth-authorization-server' ||
        this.isTokenEndpoint(url) ||
        (this.options.clientRegistrationEndpoint && this.isClientRegistrationEndpoint(url))
      ) {
        // Create an empty 204 No Content response with CORS headers
        return this.addCorsHeaders(
          new Response(null, {
            status: 204,
            headers: { 'Content-Length': '0' },
          }),
          request,
        )
      }

      // For other routes, pass through to the default handler
    }

    // Handle .well-known/oauth-authorization-server
    if (url.pathname === '/.well-known/oauth-authorization-server') {
      const response = await this.handleMetadataDiscovery(url)
      return this.addCorsHeaders(response, request)
    }

    // Handle token endpoint
    if (this.isTokenEndpoint(url)) {
      const response = await this.handleTokenRequest(request, env)
      return this.addCorsHeaders(response, request)
    }

    // Handle client registration endpoint
    if (this.options.clientRegistrationEndpoint && this.isClientRegistrationEndpoint(url)) {
      const response = await this.handleClientRegistration(request, env)
      return this.addCorsHeaders(response, request)
    }

    // Check if it's an API request
    if (this.isApiRequest(url)) {
      const response = await this.handleApiRequest(request, env, ctx)
      return this.addCorsHeaders(response, request)
    }

    // Call the default handler based on its type
    // Note: We don't add CORS headers to default handler responses
    if (this.defaultHandlerType === HandlerType.EXPORTED_HANDLER) {
      // It's an object with a fetch method
      return (this.options.defaultHandler as ExportedHandler).fetch(request, env, ctx)
    } else {
      // It's a WorkerEntrypoint class - instantiate it with ctx and env in that order
      const handler = new (this.options.defaultHandler as new (ctx: ExecutionContext, env: any) => WorkerEntrypoint)(ctx, env)
      return handler.fetch(request)
    }
  }

  /**
   * Determines if an endpoint configuration is a path or a full URL
   * @param endpoint - The endpoint configuration
   * @returns True if the endpoint is a path (starts with /), false if it's a full URL
   */
  private isPath(endpoint: string): boolean {
    return endpoint.startsWith('/')
  }

  /**
   * Matches a URL against an endpoint pattern that can be a full URL or just a path
   * @param url - The URL to check
   * @param endpoint - The endpoint pattern (full URL or path)
   * @returns True if the URL matches the endpoint pattern
   */
  private matchEndpoint(url: URL, endpoint: string): boolean {
    if (this.isPath(endpoint)) {
      // It's a path - match only the pathname
      return url.pathname === endpoint
    } else {
      // It's a full URL - match the entire URL including hostname
      const endpointUrl = new URL(endpoint)
      return url.hostname === endpointUrl.hostname && url.pathname === endpointUrl.pathname
    }
  }

  /**
   * Checks if a URL matches the configured token endpoint
   * @param url - The URL to check
   * @returns True if the URL matches the token endpoint
   */
  private isTokenEndpoint(url: URL): boolean {
    return this.matchEndpoint(url, this.options.tokenEndpoint)
  }

  /**
   * Checks if a URL matches the configured client registration endpoint
   * @param url - The URL to check
   * @returns True if the URL matches the client registration endpoint
   */
  private isClientRegistrationEndpoint(url: URL): boolean {
    if (!this.options.clientRegistrationEndpoint) return false
    return this.matchEndpoint(url, this.options.clientRegistrationEndpoint)
  }

  /**
   * Checks if a URL matches a specific API route
   * @param url - The URL to check
   * @param route - The API route to check against
   * @returns True if the URL matches the API route
   */
  private matchApiRoute(url: URL, route: string): boolean {
    if (this.isPath(route)) {
      // It's a path - match only the pathname
      return url.pathname.startsWith(route)
    } else {
      // It's a full URL - match the entire URL including hostname
      const apiUrl = new URL(route)
      return url.hostname === apiUrl.hostname && url.pathname.startsWith(apiUrl.pathname)
    }
  }

  /**
   * Checks if a URL is an API request based on the configured API route(s)
   * @param url - The URL to check
   * @returns True if the URL matches any of the API routes
   */
  private isApiRequest(url: URL): boolean {
    // Handle array of routes
    if (Array.isArray(this.options.apiRoute)) {
      // Return true if any route matches
      return this.options.apiRoute.some((route) => this.matchApiRoute(url, route))
    } else {
      // Handle single route
      return this.matchApiRoute(url, this.options.apiRoute)
    }
  }

  /**
   * Gets the full URL for an endpoint, using the provided request URL's
   * origin for endpoints specified as just paths
   * @param endpoint - The endpoint configuration (path or full URL)
   * @param requestUrl - The URL of the incoming request
   * @returns The full URL for the endpoint
   */
  private getFullEndpointUrl(endpoint: string, requestUrl: URL): string {
    if (this.isPath(endpoint)) {
      // It's a path - use the request URL's origin
      return `${requestUrl.origin}${endpoint}`
    } else {
      // It's already a full URL
      return endpoint
    }
  }

  private getStytchOAuthEndpointUrl(env: any, endpoint: string): string {
    const baseURL = env.STYTCH_PROJECT_ID.includes('test') ?
        'https://test.stytch.com/v1/public' :
        'https://api.stytch.com/v1/public';

    return `${baseURL}/${env.STYTCH_PROJECT_ID}/${endpoint}`
  }

  /**
   * Adds CORS headers to a response
   * @param response - The response to add CORS headers to
   * @param request - The original request
   * @returns A new Response with CORS headers added
   */
  private addCorsHeaders(response: Response, request: Request): Response {
    // Get the Origin header from the request
    const origin = request.headers.get('Origin')

    // If there's no Origin header, return the original response
    if (!origin) {
      return response
    }

    // Create a new response that copies all properties from the original response
    // This makes the response mutable so we can modify its headers
    const newResponse = new Response(response.body, response)

    // Add CORS headers
    newResponse.headers.set('Access-Control-Allow-Origin', origin)
    newResponse.headers.set('Access-Control-Allow-Methods', '*')
    // Include Authorization explicitly since it's not included in * for security reasons
    newResponse.headers.set('Access-Control-Allow-Headers', 'Authorization, *')
    newResponse.headers.set('Access-Control-Max-Age', '86400') // 24 hours

    return newResponse
  }

  /**
   * Handles the OAuth metadata discovery endpoint
   * Implements RFC 8414 for OAuth Server Metadata
   * @param requestUrl - The URL of the incoming request
   * @returns Response with OAuth server metadata
   */
  private async handleMetadataDiscovery(requestUrl: URL): Promise<Response> {
    // For endpoints specified as paths, use the request URL's origin
    const tokenEndpoint = this.getFullEndpointUrl(this.options.tokenEndpoint, requestUrl)
    const authorizeEndpoint = this.getFullEndpointUrl(this.options.authorizeEndpoint, requestUrl)

    let registrationEndpoint: string | undefined = undefined
    if (this.options.clientRegistrationEndpoint) {
      registrationEndpoint = this.getFullEndpointUrl(this.options.clientRegistrationEndpoint, requestUrl)
    }

    // TODO: @max - most of these fields can be dynamically loaded from the Stytch openid-configuration endpoint
    const metadata = {
      issuer: new URL(tokenEndpoint).origin,
      authorization_endpoint: authorizeEndpoint,
      token_endpoint: tokenEndpoint,
      // not implemented: jwks_uri
      registration_endpoint: registrationEndpoint,
      scopes_supported: this.options.scopesSupported,
      response_types_supported: ['code'],
      response_modes_supported: ['query'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      // Support "none" auth method for public clients
      token_endpoint_auth_methods_supported: ['none'],
      // not implemented: token_endpoint_auth_signing_alg_values_supported
      // not implemented: service_documentation
      // not implemented: ui_locales_supported
      // not implemented: op_policy_uri
      // not implemented: op_tos_uri
      revocation_endpoint: tokenEndpoint, // Reusing token endpoint for revocation
      // not implemented: revocation_endpoint_auth_methods_supported
      // not implemented: revocation_endpoint_auth_signing_alg_values_supported
      // not implemented: introspection_endpoint
      // not implemented: introspection_endpoint_auth_methods_supported
      // not implemented: introspection_endpoint_auth_signing_alg_values_supported
      code_challenge_methods_supported: ['plain', 'S256'], // PKCE support
    }

    return new Response(JSON.stringify(metadata), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  /**
   * Proxies the token request to the Stytch backend
   * @param request - The HTTP request
   * @returns Response with token data or error
   */
  private async handleTokenRequest(request: Request, env: any): Promise<Response> {
    // hack! MCP does not send this param, Stytch expects it
    // TODO @max: Fix on stytch side
    // Hardocode for now
    const requestText = await request.text();
    const params = new URLSearchParams(requestText);
    params.append('redirect_uri', 'http://localhost:5173/oauth/callback');
    const newRequestWithBody = new Request(request, { body: params.toString() });

    const tokenReq = new Request(this.getStytchOAuthEndpointUrl(env, `oauth2/token`), newRequestWithBody)
    console.log(tokenReq)
    return fetch(tokenReq)
  }

  /**
   * Handles the dynamic client registration endpoint (RFC 7591)
   * @param request - The HTTP request
   * @param env - Cloudflare Worker environment variables
   * @returns Response with client registration data or error
   */
  private async handleClientRegistration(request: Request, env: any): Promise<Response> {
    // TODO: @max forward request to stytch API.
    // For now, return static response to make MCP Inspector happy
    let clientMetadata
    try {
      const text = await request.text()
      if (text.length > 1048576) {
        // Double-check text length
        return createErrorResponse('invalid_request', 'Request payload too large, must be under 1 MiB', 413)
      }
      clientMetadata = JSON.parse(text)
    } catch (error) {
      return createErrorResponse('invalid_request', 'Invalid JSON payload', 400)
    }

    const clientInfo = {
      // HACK: Hardcoded client ID for all clients to satisfy DCR
      // TODO @max: discuss options for DCR support
      clientId: env.STYTCH_CONN_APP_CLIENT_ID,
      redirectUris: clientMetadata.redirect_uris,
      clientName: clientMetadata.client_name,
      logoUri: clientMetadata.logo_uri,
      clientUri: clientMetadata.client_uri,
      policyUri: clientMetadata.policy_uri,
      tosUri: clientMetadata.tos_uri,
      jwksUri: clientMetadata.jwks_uri,
      contacts: clientMetadata.contacts,
      grantTypes: clientMetadata.grant_types || ['authorization_code', 'refresh_token'],
      responseTypes: clientMetadata.response_types || ['code'],
      registrationDate: Math.floor(Date.now() / 1000),
      tokenEndpointAuthMethod: 'none',
    }

    const response: Record<string, any> = {
      client_id: clientInfo.clientId,
      redirect_uris: clientInfo.redirectUris,
      client_name: clientInfo.clientName,
      logo_uri: clientInfo.logoUri,
      client_uri: clientInfo.clientUri,
      policy_uri: clientInfo.policyUri,
      tos_uri: clientInfo.tosUri,
      jwks_uri: clientInfo.jwksUri,
      contacts: clientInfo.contacts,
      grant_types: clientInfo.grantTypes,
      response_types: clientInfo.responseTypes,
      token_endpoint_auth_method: clientInfo.tokenEndpointAuthMethod,
      client_id_issued_at: clientInfo.registrationDate,
    }

    return new Response(JSON.stringify(response), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  /**
   * Handles API requests by validating the access token and calling the API handler
   * @param request - The HTTP request
   * @param env - Cloudflare Worker environment variables
   * @param ctx - Cloudflare Worker execution context
   * @returns Response from the API handler or error
   */
  private async handleApiRequest(request: Request, env: any, ctx: ExecutionContext): Promise<Response> {
    // Get access token from Authorization header
    const authHeader = request.headers.get('Authorization')

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return createErrorResponse('invalid_token', 'Missing or invalid access token', 401, {
        'WWW-Authenticate': 'Bearer realm="OAuth", error="invalid_token", error_description="Missing or invalid access token"',
      })
    }
    const accessToken = authHeader.substring(7)



    let verifyResult;
    try {
      const jwks = createRemoteJWKSet(new URL(this.getStytchOAuthEndpointUrl(env, '.well-known/jwks.json')))
      verifyResult = await jwtVerify(accessToken, jwks, {
        audience: env.STYTCH_PROJECT_ID,
        // TODO: issuer will usually not have https but my project is special
        issuer: [`https://stytch.com/${env.STYTCH_PROJECT_ID}`, `stytch.com/${env.STYTCH_PROJECT_ID}`],
        typ: "JWT",
        algorithms: ['RS256'],
      })
    } catch (error) {
      console.error(error)
      return createErrorResponse('invalid_token', 'Missing or invalid access token', 401, {
        'WWW-Authenticate': 'Bearer realm="OAuth", error="invalid_token", error_description="Missing or invalid access token"',
      })
    }


    // Set the decrypted props on the context object
    ctx.props = {
      claims: verifyResult.payload,
      accessToken,
    }

    // Call the API handler based on its type
    if (this.apiHandlerType === HandlerType.EXPORTED_HANDLER) {
      // It's an object with a fetch method
      return (this.options.apiHandler as ExportedHandler).fetch(request, env, ctx)
    } else {
      // It's a WorkerEntrypoint class - instantiate it with ctx and env in that order
      const handler = new (this.options.apiHandler as new (ctx: ExecutionContext, env: any) => WorkerEntrypoint)(ctx, env)
      return handler.fetch(request)
    }
  }
}

// Helper Functions
/**
 * Helper function to create OAuth error responses
 * @param code - OAuth error code (e.g., 'invalid_request', 'invalid_token')
 * @param description - Human-readable error description
 * @param status - HTTP status code (default: 400)
 * @param headers - Additional headers to include
 * @returns A Response object with the error
 */
function createErrorResponse(code: string, description: string, status: number = 400, headers: Record<string, string> = {}): Response {
  const body = JSON.stringify({
    error: code,
    error_description: description,
  })

  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  })
}

/**
 * Default export of the OAuth provider
 * This allows users to import the library and use it directly as in the example
 */
export default StytchOAuthProvider
