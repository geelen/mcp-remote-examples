// Generated by Wrangler by running `wrangler types`

interface Env {
	OAUTH_KV: KVNamespace;
	NOTION_CLIENT_ID: string;
	NOTION_CLIENT_SECRET: string;
	MCP_OBJECT: DurableObjectNamespace<import("./src/index").NotionMCP>;
	USE_EDGE_AUTH_PROTOCOL?: string;
	MCP_CALLBACK_URL?: string;
}