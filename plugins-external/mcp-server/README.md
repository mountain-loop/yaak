# Yaak MCP Server Plugin

A Yaak plugin that exposes Yaak's functionality via the [Model Context Protocol (MCP)](https://modelcontextprotocol.io/), allowing AI assistants and other tools to interact with Yaak programmatically.

## Features

This plugin starts an MCP server on `http://127.0.0.1:64343/mcp` that provides tools for:

### HTTP Requests
- `list_http_requests` - List all HTTP requests in a workspace
- `get_http_request` - Get details of a specific HTTP request
- `send_http_request` - Send an HTTP request and get the response
- `create_http_request` - Create a new HTTP request
- `update_http_request` - Update an existing HTTP request
- `delete_http_request` - Delete an HTTP request

### Folders
- `list_folders` - List all folders in a workspace

### Workspaces
- `list_workspaces` - List all open workspaces in Yaak

### Clipboard
- `copy_to_clipboard` - Copy text to the system clipboard

### Window
- `get_workspace_id` - Get the current workspace ID
- `get_environment_id` - Get the current environment ID

### Toast Notifications
- `show_toast` - Show a toast notification in Yaak

## Usage

Once the plugin is installed and Yaak is running, the MCP server will be available at:

```
http://127.0.0.1:64343/mcp
```

Configure your MCP client to connect to this endpoint to start interacting with Yaak.

## Development

```bash
# Install dependencies
npm install

# Build the plugin
npm run build

# Development mode with auto-rebuild
npm run dev
```
