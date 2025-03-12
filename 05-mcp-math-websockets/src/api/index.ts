import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WSServerTransport } from "./websocket";
import { DurableObject } from "cloudflare:workers";
import { z } from "zod";

export interface Env {
  MCP_DO: DurableObjectNamespace;
  ASSETS: Fetcher;
}

export class MyMcpServerDurableObject extends DurableObject {
  server: McpServer;
  transport: WSServerTransport;

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);

    this.server = new McpServer({
      name: "Demo",
      version: "1.0.0",
    });

    // Define the add tool with proper typing
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

    // Subtract two numbers
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

    // Multiply two numbers
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

    // Divide two numbers
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

    // Calculate power
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

    // Calculate square root
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

    // Trigonometric functions
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

    // Natural logarithm
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

    this.transport = new WSServerTransport();
  }

  override async fetch(request: Request) {
    if (request.headers.get("Upgrade") === "websocket") {
      await this.server.connect(this.transport);
      return this.transport.upgradeResponse;
    }

    return new Response("Expected WebSocket connection", { status: 400 });
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
