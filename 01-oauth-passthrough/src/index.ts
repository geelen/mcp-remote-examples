import { Hono } from 'hono'
import { cors } from 'hono/cors'

const app = new Hono()
app.use('/*', cors())

app.get('/.well-known/oauth-authorization-server', async (c) => {
  return c.json({
    issuer: 'https://glenmaddern.auth0.com/',
    authorization_endpoint: 'https://glenmaddern.auth0.com/authorize',
    token_endpoint: 'https://glenmaddern.auth0.com/oauth/token',
    token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'private_key_jwt'],
    device_authorization_endpoint: 'https://glenmaddern.auth0.com/oauth/device/code',
    userinfo_endpoint: 'https://glenmaddern.auth0.com/userinfo',
    mfa_challenge_endpoint: 'https://glenmaddern.auth0.com/mfa/challenge',
    jwks_uri: 'https://glenmaddern.auth0.com/.well-known/jwks.json',
    registration_endpoint: 'https://glenmaddern.auth0.com/oidc/register',
    revocation_endpoint: 'https://glenmaddern.auth0.com/oauth/revoke',
    scopes_supported: [
      'openid',
      'profile',
      'offline_access',
      'name',
      'given_name',
      'family_name',
      'nickname',
      'email',
      'email_verified',
      'picture',
      'created_at',
      'identities',
      'phone',
      'address',
    ],
    response_types_supported: ['code', 'token', 'id_token', 'code token', 'code id_token', 'token id_token', 'code token id_token'],
    code_challenge_methods_supported: ['S256', 'plain'],
    response_modes_supported: ['query', 'fragment', 'form_post'],
    subject_types_supported: ['public'],
    claims_supported: [
      'aud',
      'auth_time',
      'created_at',
      'email',
      'email_verified',
      'exp',
      'family_name',
      'given_name',
      'iat',
      'identities',
      'iss',
      'name',
      'nickname',
      'phone_number',
      'picture',
      'sub',
    ],
    request_uri_parameter_supported: false,
    request_parameter_supported: false,
    id_token_signing_alg_values_supported: ['HS256', 'RS256', 'PS256'],
    token_endpoint_auth_signing_alg_values_supported: ['RS256', 'RS384', 'PS256'],
    global_token_revocation_endpoint: 'https://glenmaddern.auth0.com/oauth/global-token-revocation/connection/{connectionName}',
    global_token_revocation_endpoint_auth_methods_supported: ['global-token-revocation+jwt'],
  })
})

app.get('/sse', async (c) => {
  const auth = c.req.header('Authorization')
  const token = auth?.startsWith('Bearer ') && auth.substring(7)
  if (!token) {
    // This would kick off the OAuth registration, against the third part
    return c.text('Unauthorized', 401)
  }

  // validate the token here or just try to use it to make API calls

  // ...
})

export default app
