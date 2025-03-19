// Simple OAuth provider implementation that adds required methods for MCP

// Export the auth request type for use in other files
export type AuthRequest = {
  client_id: string;
  redirect_uri: string;
  scope: string[];
  state: string;
  response_type: string;
};

// Export helper interface that will be available on c.env.OAUTH_PROVIDER
export interface OAuthHelpers {
  parseAuthRequest(request: Request): Promise<AuthRequest>;
  completeAuthorization(options: {
    request: AuthRequest;
    userId: string;
    metadata?: Record<string, string>;
    scope: string;
    props: Record<string, any>;
  }): Promise<{ redirectTo: string }>;
}

interface SseAuthOptions {
  apiRoute: string;
  apiHandler: any;
  defaultHandler: any;
  authorizeEndpoint: string;
  tokenEndpoint: string;
  clientRegistrationEndpoint?: string;
}

/**
 * OAuthProvider implementation with the required methods for MCP
 */
export default class OAuthProvider {
  options: SseAuthOptions;
  
  constructor(options: SseAuthOptions) {
    this.options = options;
  }
  
  /**
   * Fetch implementation
   */
  async fetch(request: Request, env: any, ctx: any): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    
    // Set up OAUTH_PROVIDER on env if not already present
    if (!env.OAUTH_PROVIDER) {
      // Create helpers object with methods from this class
      env.OAUTH_PROVIDER = {
        parseAuthRequest: this.parseAuthRequest.bind(this),
        completeAuthorization: this.completeAuthorization.bind(this),
        // Add other methods needed by OAuthHelpers
      };
    }
    
    // Handle API requests (e.g., /sse endpoint)
    if (path.startsWith(this.options.apiRoute)) {
      // Get accept header to check if this is an SSE request
      const acceptHeader = request.headers.get('Accept') || '';
      
      // Only proceed with SSE requests (normal requests from browser will get normal responses)
      if (acceptHeader.includes('text/event-stream')) {
        // For SSE requests, check if we have auth token
        const authHeader = request.headers.get('Authorization');
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
          // No auth token - return 401 with proper SSE content type
          const headers = new Headers({
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
          });
          
          // Add WWW-Authenticate header to trigger auth
          headers.set('WWW-Authenticate', 'Bearer realm="OAuth"');
          
          return new Response('event: error\ndata: {"error":"unauthorized","message":"Authentication required"}\n\n', {
            status: 401,
            headers
          });
        }
      }
      
      // For the router pattern used in MCPEntrypoint
      if (typeof this.options.apiHandler.fetch === 'function') {
        return await this.options.apiHandler.fetch(request, env, ctx);
      } 
      // For the static Router class pattern
      else if (this.options.apiHandler.prototype?.fetch) {
        const handler = new this.options.apiHandler(ctx, env);
        return await handler.fetch(request);
      } 
      else {
        return new Response('API handler not properly configured', { status: 500 });
      }
    }
    
    // Handle token endpoint for token exchange
    if (path === this.options.tokenEndpoint) {
      if (request.method === 'POST') {
        try {
          // Parse request (form or JSON)
          let grantType, code, redirectUri, codeVerifier;
          const contentType = request.headers.get('Content-Type') || '';
          
          if (contentType.includes('application/json')) {
            const body = await request.json();
            grantType = body.grant_type;
            code = body.code;
            redirectUri = body.redirect_uri;
            codeVerifier = body.code_verifier;
          } else {
            // Assume form data
            const formData = await request.formData();
            grantType = formData.get('grant_type');
            code = formData.get('code');
            redirectUri = formData.get('redirect_uri');
            codeVerifier = formData.get('code_verifier');
          }
          
          // Validate grant type
          if (grantType !== 'authorization_code') {
            return new Response(JSON.stringify({
              error: 'unsupported_grant_type',
              error_description: 'Only authorization_code grant type is supported'
            }), {
              status: 400,
              headers: { 'Content-Type': 'application/json' }
            });
          }
          
          // In a real implementation, validate the code, code verifier, etc.
          // For now, generate a fake token
          const now = Math.floor(Date.now() / 1000);
          const accessTokenExpiresIn = 3600; // 1 hour
          const refreshTokenExpiresIn = 86400 * 30; // 30 days
          
          // Create the token response
          const tokenResponse = {
            access_token: `access-token-${crypto.randomUUID()}`,
            token_type: 'bearer',
            expires_in: accessTokenExpiresIn,
            refresh_token: `refresh-token-${crypto.randomUUID()}`,
            scope: 'read write'
          };
          
          return new Response(JSON.stringify(tokenResponse), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        } catch (error) {
          return new Response(JSON.stringify({
            error: 'invalid_request',
            error_description: 'Invalid token request'
          }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
          });
        }
      }
      
      // Method not allowed
      return new Response(JSON.stringify({
        error: 'method_not_allowed',
        error_description: 'Only POST requests are allowed for token exchange'
      }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // Handle OAuth registration endpoint
    if (path === this.options.clientRegistrationEndpoint) {
      // Process dynamic client registration
      if (request.method === 'POST') {
        try {
          const clientInfo = await request.json();
          
          // Store the client information
          const storedInfo = await this.saveClientInformation(clientInfo);
          
          // Return the client info
          return new Response(JSON.stringify(storedInfo), {
            status: 201,
            headers: { 'Content-Type': 'application/json' }
          });
        } catch (error) {
          return new Response(JSON.stringify({ 
            error: 'invalid_request',
            error_description: 'Invalid client registration request'
          }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
          });
        }
      }
      
      // Method not allowed
      return new Response(JSON.stringify({ 
        error: 'method_not_allowed',
        error_description: 'Only POST requests are allowed for client registration'
      }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // Handle default requests (e.g., /authorize, /callback)
    return this.options.defaultHandler.fetch(request, env, ctx);
  }
  
  /**
   * Parse an OAuth authorization request
   */
  async parseAuthRequest(request: Request): Promise<AuthRequest> {
    const url = new URL(request.url);
    const clientId = url.searchParams.get('client_id') || '';
    const redirectUri = url.searchParams.get('redirect_uri') || '';
    const scope = url.searchParams.get('scope') || '';
    const state = url.searchParams.get('state') || '';
    const responseType = url.searchParams.get('response_type') || 'code';
    
    return {
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: scope.split(' '),
      state: state,
      response_type: responseType
    };
  }
  
  /**
   * Complete an authorization request
   */
  async completeAuthorization(options: {
    request: AuthRequest;
    userId: string;
    metadata?: Record<string, string>;
    scope: string;
    props: Record<string, any>;
  }): Promise<{ redirectTo: string }> {
    console.error('CompleteAuthorization called with props:', JSON.stringify({
      userId: options.userId,
      metadata: options.metadata,
      hasProps: !!options.props,
      redirectUri: options.request.redirect_uri
    }));
    
    try {
      // Get the redirect URI from the request - this is where we'll redirect the user
      const redirectUri = new URL(options.request.redirect_uri);
      
      // Create a secured token containing the Notion access token
      // The client will extract this to use for API requests
      const payload = {
        userId: options.userId,
        metadata: options.metadata || {},
        scope: options.scope,
        props: options.props, // This includes the Notion access token
        created: Date.now()
      };
      
      // Encode the token as base64 JSON
      const authToken = btoa(JSON.stringify(payload));
      
      // Add the token as a URL fragment - this ensures it's not sent to the server
      // Modern OAuth typically uses URL fragments for security
      redirectUri.hash = `token=${encodeURIComponent(authToken)}`;
      
      console.error('Redirecting to:', redirectUri.toString().replace(/token=.*/, 'token=[REDACTED]'));
      return { redirectTo: redirectUri.toString() };
    } catch (error) {
      console.error('Error in completeAuthorization:', error);
      // Provide a fallback error URL if everything fails
      if (options.request.redirect_uri) {
        return { redirectTo: `${options.request.redirect_uri}#error=server_error` };
      } else {
        return { redirectTo: 'https://example.com/callback#error=server_error' };
      }
    }
  }
  
  /**
   * Returns tokens for a specific user
   */
  async tokens(userId: string) {
    // In a real implementation, this would fetch tokens from storage
    return {};
  }
  
  /**
   * Returns OAuth client information for registration
   */
  async clientInformation() {
    // Return client information for dynamic registration
    return {
      client_id: "YOUR_NOTION_CLIENT_ID",
      redirect_uris: ["https://<YOUR_WORKER_DOMAIN>/callback"],
      grant_types: ["authorization_code"],
      token_endpoint_auth_method: "client_secret_basic"
    };
  }
  
  /**
   * Saves client information for dynamic registration
   */
  async saveClientInformation(clientInfo: any) {
    // Ensure client_id is always set
    const info = { ...clientInfo };
    if (!info.client_id) {
      info.client_id = "notion-mcp-client-" + crypto.randomUUID();
    }
    
    // Add required fields
    if (!info.client_id_issued_at) {
      info.client_id_issued_at = Math.floor(Date.now() / 1000);
    }
    
    // This method would save client info to storage in a real implementation
    return info;
  }
}