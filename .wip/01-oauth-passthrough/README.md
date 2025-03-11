# OAuth Passthrough

**BLOCKED DUE TO LACK OF PROVIDER SUPPORT**

The idea: instead of making the MCP Server an OAuth Server, make it _forward_ all OAuth routes to an external provider. Once the authorization flow has completed, each call to the MCP Server should then have a `Bearer` token that the MCP Server can use to either make API requests (if the upstream provider was a service like Github, and the MCP Server was for performing actions on your Github account, for example), or validate with the identify service and proceed. Note: the MCP Server would have no way of knowing an auth_token was valid without checking in with the issuer.

This would mean the MCP Server never sees your refresh_token, only your access_token, and drastically simplifies its implementation—the MCP Server would only need to add a route for `.well-known/oauth-authorization-server` that would point the client at the third-party registration server: 

```js
app.get('/.well-known/oauth-authorization-server', async (c) => {
  return c.json({
    issuer: 'https://example.auth0.com/',
    authorization_endpoint: 'https://example.auth0.com/authorize',
    token_endpoint: 'https://example.auth0.com/oauth/token',
    registration_endpoint: 'https://example.auth0.com/oidc/register'
    // etc
  })
})

app.get('/sse', async (c) => {
  const auth = c.req.header('Authorization')
  const token = auth?.startsWith('Bearer ') && auth.substring(7)
  if (!token) {
    // This would kick off the OAuth registration
    return c.text('Unauthorized', 401)
  }

  // validate the token here or just try to use it to make API calls

  // ...
})

```

This might have been nice, but MCP's use of Dynamic Client Registration is incompatible with the public OAuth services I've been able to find.