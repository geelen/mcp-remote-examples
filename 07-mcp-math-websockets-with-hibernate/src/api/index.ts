import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MCPEntrypoint } from "./mcp-entrypoint.js";

export interface Env {
  MCP_DO: DurableObjectNamespace;
  ASSETS: Fetcher;
}

export class MyMcpServerDurableObject extends MCPEntrypoint {
  getServer(): McpServer {
    let server = new McpServer({
      name: "Demo",
      version: "1.0.0",
    });

    // Define the add tool with proper typing
    server.tool(
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

    // Subtract two numbers
    server.tool(
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

    // Multiply two numbers
    server.tool(
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

    // Divide two numbers
    server.tool(
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

    // Calculate power
    server.tool(
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

    // Calculate square root
    server.tool(
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

    // Trigonometric functions
    server.tool(
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

    server.tool(
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

    server.tool(
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

    // Natural logarithm
    server.tool(
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

    return server;
  }
}

export default {
  async fetch(
    request: Request,
    env: Env,
    _ctx: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.endsWith("/mcp")) {
      const sessionId = url.searchParams.get("sessionId");
      let object = env.MCP_DO.get(
        sessionId
          ? env.MCP_DO.idFromString(sessionId)
          : env.MCP_DO.newUniqueId()
      );
      return object.fetch(request);
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
