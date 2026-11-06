# Yaak MCP Server Plugin

Exposes Yaak's functionality via the [Model Context Protocol (MCP)](https://modelcontextprotocol.io/).

**Deprecated.** The Yaak CLI serves the same tools with `yaak mcp`, with the app open or
closed. Install the CLI (`npm install -g @yaakapp/cli`), point your agent at `yaak mcp`, then
uninstall this plugin. Settings > Agents in Yaak has the command for each agent.

## Setup

Add this to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "yaak": {
      "command": "yaak",
      "args": ["mcp"]
    }
  }
}
```

Restart Claude Desktop.

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

## Environment Selection

`send_http_request` accepts an optional `environmentId` for that execution. It overrides the
active environment without changing the selection in Yaak. Omitting it uses the host's
active environment, as before.

The ID must identify a base or sub-environment in the request's workspace. An empty,
unknown, foreign-workspace, or folder environment ID returns an error before sending.
Use the base environment ID to run with global variables only. Folder variables still
apply according to the request's folder hierarchy.

```json
{
  "id": "rq_example",
  "workspaceId": "wk_example",
  "environmentId": "ev_staging"
}
```

This requires a Yaak host with support for the `environmentId` plugin API field;
older hosts ignore it. `get_environment_id` reports the active selection, not the
override used by a previous send.
