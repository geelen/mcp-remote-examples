import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "./streamable-http.js";

export function serveMcp<Env>({
  server,
  endpoint,
}: {
  server: McpServer;
  endpoint: string;
}) {
  return async (request: Request, env: Env, ctx: ExecutionContext) => {
    let transport = new StreamableHTTPServerTransport(endpoint);
    server.connect(transport);
    return transport.handleRequest(request, env, ctx);
  };
}
