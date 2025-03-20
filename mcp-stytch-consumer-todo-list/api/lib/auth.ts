import {createRemoteJWKSet, jwtVerify} from "jose";
import {createMiddleware} from "hono/factory";
import {HTTPException} from "hono/http-exception";
import {getCookie} from "hono/cookie";

/**
 * stytchAuthMiddleware is a Hono middleware that validates that the user is logged in
 */
export const stytchAuthMiddeware = createMiddleware<{
    Variables: {
        userID: string
    },
    Bindings: Env,
}>(async (c, next) => {
    const sessionCookie = getCookie(c, 'stytch_session_jwt');

    try {
        const verifyResult = await validateStytchJWT(sessionCookie ?? '', c.env)
        c.set('userID', verifyResult.payload.sub!);
    } catch (error) {
        console.error(error);
        throw new HTTPException(401, {message: 'Unauthenticated'})
    }

    await next()
})

/**
 * validateBearerToken checks that the request has a valid Stytch-issued bearer token
 */
export async function validateBearerToken(request: Request, env: Env) {
    const authHeader = request.headers.get('Authorization')

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw new Error('Missing or invalid access token');
    }
    const accessToken = authHeader.substring(7)

    const verifyResult = await validateStytchJWT(accessToken, env)

    // Return the decrypted props to be passed on the ctx
    return {
        claims: verifyResult.payload,
        accessToken,
    }
}

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

async function validateStytchJWT(token: string, env: Env) {
    if (!jwks) {
        jwks = createRemoteJWKSet(new URL(getStytchOAuthEndpointUrl(env, '.well-known/jwks.json')))
    }

    return await jwtVerify(token, jwks, {
        audience: env.STYTCH_PROJECT_ID,
        issuer: [`stytch.com/${env.STYTCH_PROJECT_ID}`],
        typ: "JWT",
        algorithms: ['RS256'],
    })
}

export function getStytchOAuthEndpointUrl(env: Env, endpoint: string): string {
    const baseURL = env.STYTCH_PROJECT_ID.includes('test') ?
        'https://test.stytch.com/v1/public' :
        'https://api.stytch.com/v1/public';

    return `${baseURL}/${env.STYTCH_PROJECT_ID}/${endpoint}`
}