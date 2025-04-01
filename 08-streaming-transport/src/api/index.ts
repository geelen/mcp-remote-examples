import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { serveMcp } from "./serve-mcp.js";

let server = new McpServer({
  name: "Demo",
  version: "1.0.0",
});

server.tool("add", { a: z.number(), b: z.number() }, async ({ a, b }) => ({
  content: [{ type: "text", text: String(a + b) }],
}));

server.tool("subtract", { a: z.number(), b: z.number() }, async ({ a, b }) => ({
  content: [{ type: "text", text: String(b - a) }],
}));

server.tool("multiply", { a: z.number(), b: z.number() }, async ({ a, b }) => ({
  content: [{ type: "text", text: String(a * b) }],
}));

export default serveMcp<Env>(server);

// export default server;
// // Export the OAuth handler as the default
// export default new OAuthProvider({
//   apiRoute: "/sse",
//   apiHandler: MyMCP.mount("/sse"),
//   defaultHandler: app,
//   authorizeEndpoint: "/authorize",
//   tokenEndpoint: "/token",
//   clientRegistrationEndpoint: "/register",
// });

// import { Hono } from "hono";
// const app = new Hono<{ Bindings: Env }>();

// app.get("/api/", (c) => c.json({ name: "Cloudflare" }));

// app.get("*", (c) => {
//   return c.env.ASSETS.fetch(c.req.raw);
// });

// export default app;
