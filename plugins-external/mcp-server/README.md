# Yaak MCP Server Plugin

Exposes Yaak's functionality via the [Model Context Protocol (MCP)](https://modelcontextprotocol.io/).

## Setup

Add this to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "yaak": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "http://127.0.0.1:64343/mcp"]
    }
  }
}
```

Restart Claude Desktop and make sure Yaak is running.

## Available Tools

- `list_http_requests` - List all HTTP requests in a workspace
- `get_http_request` - Get details of a specific HTTP request
- `send_http_request` - Send an HTTP request and get the response
- `create_http_request` - Create a new HTTP request
- `update_http_request` - Update an existing HTTP request
- `delete_http_request` - Delete an HTTP request
- `list_folders` - List all folders in a workspace
- `list_workspaces` - List all open workspaces
- `get_workspace_id` - Get the current workspace ID
- `get_environment_id` - Get the current environment ID
- `copy_to_clipboard` - Copy text to the system clipboard
- `show_toast` - Show a toast notification in Yaak
