import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { DurableMCP } from "workers-mcp";
import { z } from "zod";

export interface Env {
  MCP_OBJECT: DurableObjectNamespace;
  ASSETS: Fetcher;
}

export class MCPMathServer extends DurableMCP {
  server = new McpServer({
    name: "Math Demo",
    version: "1.0.0",
  });

  async init() {
    this.server.tool(
      "add",
      {
        a: z.number(),
        b: z.number(),
      },
      async ({ a, b }) => {
        return {
          content: [{ type: "text", text: String(a + b) }],
        };
      }
    );

    this.server.tool(
      "subtract",
      {
        a: z.number(),
        b: z.number(),
      },
      async ({ a, b }) => {
        return {
          content: [{ type: "text", text: String(a - b) }],
        };
      }
    );

    this.server.tool(
      "multiply",
      {
        a: z.number(),
        b: z.number(),
      },
      async ({ a, b }) => {
        return {
          content: [{ type: "text", text: String(a * b) }],
        };
      }
    );

    this.server.tool(
      "divide",
      {
        a: z.number(),
        b: z.number(),
      },
      async ({ a, b }) => {
        if (b === 0) {
          throw new Error("Division by zero is not allowed");
        }
        return {
          content: [{ type: "text", text: String(a / b) }],
        };
      }
    );

    this.server.tool(
      "power",
      {
        base: z.number(),
        exponent: z.number(),
      },
      async ({ base, exponent }) => {
        return {
          content: [{ type: "text", text: String(Math.pow(base, exponent)) }],
        };
      }
    );

    this.server.tool(
      "sqrt",
      {
        value: z.number(),
      },
      async ({ value }) => {
        if (value < 0) {
          throw new Error("Cannot calculate square root of negative number");
        }
        return {
          content: [{ type: "text", text: String(Math.sqrt(value)) }],
        };
      }
    );

    this.server.tool(
      "sin",
      {
        angle: z.number(),
      },
      async ({ angle }) => {
        return {
          content: [{ type: "text", text: String(Math.sin(angle)) }],
        };
      }
    );

    this.server.tool(
      "cos",
      {
        angle: z.number(),
      },
      async ({ angle }) => {
        return {
          content: [{ type: "text", text: String(Math.cos(angle)) }],
        };
      }
    );

    this.server.tool(
      "tan",
      {
        angle: z.number(),
      },
      async ({ angle }) => {
        return {
          content: [{ type: "text", text: String(Math.tan(angle)) }],
        };
      }
    );

    this.server.tool(
      "log",
      {
        value: z.number(),
      },
      async ({ value }) => {
        if (value <= 0) {
          throw new Error("Cannot calculate logarithm of non-positive number");
        }
        return {
          content: [{ type: "text", text: String(Math.log(value)) }],
        };
      }
    );
  }
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);
    const router = MCPMathServer.mount("/mcp");

    if (
      url.pathname.startsWith("/mcp") ||
      url.pathname.startsWith("/sse/message")
    ) {
      return router.fetch(request, env, ctx);
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
