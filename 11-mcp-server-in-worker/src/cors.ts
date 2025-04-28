export interface CORSOptions {
  origin?: string;
  methods?: string;
  headers?: string;
  maxAge?: number;
}

// CORS helper function
export function handleCORS(
  request: Request,
  corsOptions?: CORSOptions
): Response | null {
  const origin = request.headers.get("Origin") || "*";
  const corsHeaders = {
    "Access-Control-Allow-Origin": corsOptions?.origin || origin,
    "Access-Control-Allow-Methods":
      corsOptions?.methods || "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": corsOptions?.headers || "Content-Type",
    "Access-Control-Max-Age": (corsOptions?.maxAge || 86400).toString(),
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  return null;
}
