import {TodoMPC} from "./TodoMPC.ts";
import {getStytchOAuthEndpointUrl, validateBearerToken} from "./lib/auth";
import {app} from "./TodoAPI.ts";
import {cors} from "hono/cors";

// Export the TodoMPC class so the Worker runtime can find it
export {TodoMPC};

app
    .use(cors({ origin: '*' }))
    .get('/.well-known/oauth-authorization-server', async (c) => {
        const url = new URL(c.req.url);
        return c.json({
            issuer: c.env.STYTCH_PROJECT_ID,
            // Link to the OAuth Authorization screen implemented within the React UI
            authorization_endpoint: `${url.origin}/oauth/authorize`,
            token_endpoint: getStytchOAuthEndpointUrl(c.env, 'oauth2/token'),
            registration_endpoint: getStytchOAuthEndpointUrl(c.env, 'oauth2/register'),
            scopes_supported: ['openid', 'profile', 'email', 'offline_access'],
            response_types_supported: ['code'],
            response_modes_supported: ['query'],
            grant_types_supported: ['authorization_code', 'refresh_token'],
            token_endpoint_auth_methods_supported: ['none'],
            code_challenge_methods_supported: ['S256'],
        })
    })

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);

        // API routes should be handled by the Hono app
        if (url.pathname.startsWith("/api") || url.pathname.startsWith("/.well-known")) {
            return app.fetch(request, env);
        }

        // SSE routes should be handled by the MCP server
        // Only allow authenticated requests through
        if (url.pathname.startsWith("/sse")) {
            try {
                ctx.props = await validateBearerToken(request, env);
            } catch (error) {
                console.error(error)
                return createErrorResponse('invalid_token', 'Missing or invalid access token', 401, {
                    'WWW-Authenticate': 'Bearer realm="OAuth", error="invalid_token", error_description="Missing or invalid access token"',
                })
            }

            // @ts-ignore
            const handler = new TodoMPC.Router(ctx, env)
            return handler.fetch(request)
        }

        // Everything else is a static asset to serve up
        return env.ASSETS.fetch(request);
    }
} satisfies ExportedHandler<Env>;


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

