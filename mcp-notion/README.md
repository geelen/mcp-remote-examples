# Notion Assistant MCP

A Model Context Protocol (MCP) server for interacting with Notion. This integration allows you to use the Notion API with any MCP-compatible client, such as Claude.

## What Is This?

This is a Cloudflare Workers MCP server that performs a dual OAuth role:

1. **Acts as an OAuth Server to your MCP clients** (like Claude):
   - It authenticates MCP clients using the OAuth protocol
   - It provides MCP clients with access tokens to make API calls
   - It handles MCP WebSocket connections and tool invocations

2. **Acts as an OAuth Client to Notion's OAuth server**:
   - It redirects users to Notion for permission consent
   - It receives and stores access tokens from Notion
   - It makes API calls to Notion on behalf of users

This dual OAuth bridging role allows MCP clients to securely access Notion's API without needing direct Notion credentials.

## Features

- OAuth authentication with Notion
- List and search pages in your Notion workspace
- Read and create Notion pages
- Query and add items to Notion databases
- Full markdown support for page content

## Setup

### Prerequisites

- [Notion Integration](https://www.notion.so/my-integrations) created in the Notion API
- Cloudflare Workers account
- Node.js and npm/pnpm installed

### Configuration

1. Create a Notion integration at https://www.notion.so/my-integrations
   - Set the redirect URI to your Worker domain (e.g., `https://<YOUR_WORKER_DOMAIN>/callback`)
   - Take note of the Client ID and Client Secret

2. Create a KV namespace in Cloudflare Workers:
   - Go to Cloudflare Dashboard > Workers & Pages > KV
   - Create a new namespace (e.g., `OAUTH_KV`)
   - Take note of the KV namespace ID

3. Update `wrangler.jsonc` with your credentials:
   ```json
   "kv_namespaces": [
     {
       "binding": "OAUTH_KV",
       "id": "YOUR_KV_NAMESPACE_ID"
     }
   ],
   "vars": {
     "NOTION_CLIENT_ID": "YOUR_NOTION_CLIENT_ID",
     "NOTION_CLIENT_SECRET": "YOUR_NOTION_CLIENT_SECRET",
     "USE_EDGE_AUTH_PROTOCOL": "true",
     "MCP_CALLBACK_URL": "http://localhost:3335/callback"
   }
   ```

4. Update redirect URIs in the code:
   - In `src/index.ts`, replace all instances of `https://<YOUR_WORKER_DOMAIN>/callback` with your actual Worker domain
   - In `src/oauth/oauth-provider.ts`, update the same URLs

### Development

```bash
npm install
npm run dev
```

### Deployment

```bash
npm run deploy
```

## Testing with Claude and Other MCP Clients

You can easily connect to this MCP server using the `mcp-remote` tool, which establishes a secure connection between MCP clients and your server:

```bash
npx mcp-remote <your-server-url>
```

This command creates a local MCP server that forwards requests to your deployed Workers server. It handles the OAuth flow automatically, allowing you to connect Claude Desktop, Claude on the web, or other MCP-compatible tools to your Notion MCP server.

Once connected, you can use commands in Claude like:

```
/notion myAccount
/notion listPages
/notion getPage pageId=<YOUR_PAGE_ID>
```

## OAuth Flow Explained

The complete OAuth flow involves three parties: the MCP client (e.g., Claude), this Workers MCP server, and Notion's OAuth server:

1. **Initial MCP Client Connection**:
   - When an MCP client connects to this server at `/sse`, it initiates an MCP session
   - The server detects no authorization and returns a 401 with the `WWW-Authenticate` header
   - The MCP client (or its local proxy) recognizes this as needing OAuth authentication

2. **First OAuth Flow: MCP Client ↔ Workers MCP Server**:
   - The MCP client redirects the user to the Workers `/authorize` endpoint
   - The Workers MCP server stores the MCP client's request information in KV storage with a unique state parameter

3. **Second OAuth Flow: Workers MCP Server ↔ Notion**:
   - The Workers server redirects the user to Notion's OAuth authorization page
   - The user logs into Notion and grants the requested permissions to the Worker
   - Notion redirects back to the Worker's `/callback` endpoint with an authorization code

4. **Token Exchange with Notion**:
   - The Worker exchanges the code for a Notion access token
   - The Worker stores the access token and user information

5. **Authentication Completion Between MCP Client and Worker**:
   - The Worker creates a secure token containing the necessary Notion access credentials
   - The Worker redirects back to the MCP client's callback URL with this token
   - The MCP client stores this token for future use with the Worker

6. **Authenticated MCP Communication**:
   - The MCP client includes the token in subsequent requests to the Worker
   - The Worker uses the embedded Notion token to make API calls to Notion
   - The MCP client can now interact with Notion through the MCP protocol

This dual OAuth approach allows the MCP client to securely access Notion without directly handling Notion credentials.

## Available Tools

- `myAccount`: Get information about your Notion account
- `listPages`: List your recent Notion pages
- `listDatabases`: List your Notion databases
- `getPage`: Read the content of a Notion page
- `search`: Search your Notion workspace
- `queryDatabase`: Query items from a Notion database
- `createPage`: Create a new Notion page
- `addDatabaseItem`: Add a new item to a Notion database

## Tool Usage Examples

Here are some examples of how to use the tools from Claude:

```
/notion listPages limit=5
```

```
/notion search query="meeting notes"
```

```
/notion createPage parentId=<PAGE_ID> title="My New Page" content="# Hello World\n\nThis is a test page created via MCP."
```

```
/notion queryDatabase databaseId=<DATABASE_ID> limit=10
```

## Security

This integration requests the following Notion permissions:
- `read_content`: Read Notion pages and databases
- `update_content`: Update Notion pages
- `create_content`: Create new Notion pages
- `read_blocks`: Read content blocks within pages
- `update_blocks`: Update content blocks
- `read_databases`: Access database content
- `create_databases`: Create new databases
- `update_databases`: Update database content

## License

MIT