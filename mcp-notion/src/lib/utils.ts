/**
 * Add CORS headers to a Response
 */
export function addCorsHeaders(response: Response, request: Request): Response {
  // Get the Origin header from the request
  const origin = request.headers.get('Origin')
  
  // Clone the response to add headers
  const corsResponse = new Response(response.body, response)
  
  // Add comprehensive CORS headers for maximum compatibility
  corsResponse.headers.set('Access-Control-Allow-Origin', origin || '*')
  corsResponse.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  corsResponse.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, X-Requested-With')
  corsResponse.headers.set('Access-Control-Allow-Credentials', 'true')
  corsResponse.headers.set('Access-Control-Max-Age', '86400') // 24 hours
  
  // Special handling for SSE connections
  if (response.headers.get('Content-Type')?.includes('text/event-stream')) {
    console.error('[debug] SSE connection - adding extra headers for streaming');
    corsResponse.headers.set('Cache-Control', 'no-cache, no-transform')
    corsResponse.headers.set('Connection', 'keep-alive')
    corsResponse.headers.set('X-Accel-Buffering', 'no') // Helps with Nginx proxy buffering
  }
  
  return corsResponse
}