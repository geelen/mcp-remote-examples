import './routes'
import app from './routes'
import OAuthProvider from './lib/OAuthProvider'
import { MCPEntrypoint } from './lib/MCPEntrypoint'

export class MyMCP extends MCPEntrypoint {}

export const MyOauth = new OAuthProvider({
  apiRoute: '/sse',
  apiHandler: MyMCP.Router,
  defaultHandler: app,
  authorizeEndpoint: '/authorize',
  tokenEndpoint: '/token',
  clientRegistrationEndpoint: '/register',
})

export default MyOauth
