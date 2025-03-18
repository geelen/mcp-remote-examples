import OAuthProvider, {AuthRequest, OAuthHelpers} from 'workers-oauth-provider'
import {MCPEntrypoint} from './lib/MCPEntrypoint'
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js'
import {z} from 'zod'
import {Hono} from 'hono'
import pick from 'just-pick'
import {Octokit} from 'octokit'
import StytchOAuthProvider from './lib/StytchOAuthProvider'
import {layout} from './lib/ui'

// Context from the auth process, extracted from the Stytch auth token JWT
// and provided to the MCP Server as this.props
type Props = {
    claims: {
        "iss": string,
        "scope": string,
        "sub": string,
        "aud": string[],
        "client_id": string,
        "exp": number,
        "iat": number,
        "nbf": number,
        "jti": string,
    },
    accessToken: string
}

export class MyMCP extends MCPEntrypoint<Props> {
    get server() {
        const server = new McpServer({
            name: 'Stytch Identity Provider Demo',
            version: '1.0.0',
        })

        server.tool('add', 'Add two numbers the way only MCP can', {a: z.number(), b: z.number()}, async ({a, b}) => ({
            content: [{type: 'text', text: String(a + b)}],
        }))

        server.tool('whoami', 'Tasty props from my OAuth provider', {}, async () => ({
            content: [{type: 'text', text: JSON.stringify(pick(this.props.claims, 'scope', 'sub'))}],
        }))

        server.tool('userInfoHTTP', 'Get user info from Stytch, via HTTP', {}, async () => {
            const projectID = this.env.STYTCH_PROJECT_ID;
            const res = await fetch(`https://test.stytch.com/v1/public/${projectID}/oauth2/userinfo`, {
                headers: {Authorization: `Bearer ${this.props.accessToken}`, 'User-Agent': '05-stytch-identity'},
            })
            return {content: [{type: 'text', text: await res.text()}]}
        })

        return server
    }
}

const app = new Hono<{ Bindings: Env & { OAUTH_PROVIDER: OAuthHelpers } }>()

/**
 * Login Endpoint
 *
 * This route logs the user in using the Stytch UI + EML OTP flow
 */
app.get('/login', async (c) => {
    const script = `
        <script type="module">
            import {StytchUIClient, Products, OTPMethods, OAuthProviders} from '@stytch/vanilla-js';
            const client  = new StytchUIClient('${c.env.STYTCH_PUBLIC_TOKEN}');
            const handleOnLoginComplete = (evt) => {
                if(evt.type !== "AUTHENTICATE_FLOW_COMPLETE") return;
                
                const returnTo = localStorage.getItem('returnTo')
                if (returnTo) {
                    localStorage.setItem('returnTo', null);
                    window.location.href = returnTo
                }
            }
            client.mountLogin({
                elementId: '#entrypoint',
                config: {
                    products: [Products.otp, Products.oauth],
                    otpOptions: {
                       methods: [OTPMethods.Email],
                    },
                    oauthOptions: {
                        providers: [{ type: OAuthProviders.Google }],
                        loginRedirectURL: window.location.origin + '/authenticate',
                        signupRedirectURL: window.location.origin + '/authenticate',
                    }
                },
                callbacks: {onEvent: handleOnLoginComplete,}
            })
        </script>
  `
    return c.html(layout('MCP Remote Auth Demo - Authorization', script))
})

/**
 * OAuth Authorization Endpoint
 *
 * This route initiates the GitHub OAuth flow when a user wants to log in.
 * It creates a random state parameter to prevent CSRF attacks and stores the
 * original OAuth request information in KV storage for later retrieval.
 * Then it redirects the user to GitHub's authorization page with the appropriate
 * parameters so the user can authenticate and grant permissions.
 */
app.get('/authorize', async (c) => {
    const script = `
        <script type="module">
            import {StytchUIClient} from '@stytch/vanilla-js';
            const client  = new StytchUIClient('${c.env.STYTCH_PUBLIC_TOKEN}');
            if (client.user.getSync() === null) {
                console.log('Not logged in, redirecting to login');
                localStorage.setItem('returnTo', window.location.href);
                window.location.href = '/login';
            } else {
                client.mountIdentityProvider({
                    elementId: '#entrypoint'
                })    
            }
        </script>
  `
    return c.html(layout('MCP Remote Auth Demo - Authorization', script))
})

app.get('/authenticate', async (c) => {
    const script = `
        <script type="module">
            import {StytchUIClient} from '@stytch/vanilla-js';
            const client = new StytchUIClient('${c.env.STYTCH_PUBLIC_TOKEN}');
            const params = new URLSearchParams(window.location.search);
            
            client.oauth.authenticate(params.get('token'), {session_duration_minutes: 60 })
                .then(() => {
                    const returnTo = localStorage.getItem('returnTo')
                    if (returnTo) {
                        localStorage.setItem('returnTo', null);
                        window.location.href = returnTo;
                    }
                })
                .catch(err => {
                    console.error(err)
                    document.querySelector('#entrypoint').innerHTML = 'Error: <code>' + err.message + '</code>';        
                });
        </script>
    `
    return c.html(layout('MCP Remote Auth Demo - Authorization', script))
})

app.get('/', async (c) => {
    const script = `
        <script type="module">
            document.querySelector('#entrypoint').innerHTML = 'Plug in <b><code>'+
             window.location.href + 'sse' + 
             '</code></b> to your MCP instance to access this demo.';
        </script>
    `
    return c.html(layout('MCP Remote Auth Demo - Authorization', script))
})

export default new StytchOAuthProvider({
    apiRoute: '/sse',
    apiHandler: MyMCP.Router,
    defaultHandler: app,
    authorizeEndpoint: '/authorize',
    tokenEndpoint: '/token',
    clientRegistrationEndpoint: '/register',
})
