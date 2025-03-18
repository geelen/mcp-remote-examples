# `mcp-remote`

**EXPERIMENTAL PROOF OF CONCEPT**

Connect an MCP Client that only supports local (stdio) servers to a Remote MCP Server, with auth support:

E.g: Claude Desktop or Windsurf

```json
{
  "mcpServers": {
    "remote-example": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://remote.mcp.server/sse"
      ]
    }
  }
}
```

Cursor:

![image](https://github.com/user-attachments/assets/14338bfa-a779-4e8a-a477-71f72cc5d99d)

