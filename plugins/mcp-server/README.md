# Yaak MCP Server Plugin

This plugin exposes Yaak functionality via the Model Context Protocol (MCP), allowing AI assistants like Claude Desktop to control Yaak.

## Features

- Runs an MCP server over HTTP/SSE on `http://127.0.0.1:64342/sse`
- Provides tools that AI assistants can use to interact with Yaak

## Available Tools

### `show_toast`

Show a toast notification in Yaak.

**Parameters:**
- `message` (string, required): The message to display
- `icon` (string, optional): Icon name - one of: info, success, warning, error

**Example:**
```json
{
  "message": "Hello from Claude!",
  "icon": "success"
}
```

## Configuration for Claude Desktop

Add this to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "yaak": {
      "url": "http://127.0.0.1:64342/sse"
    }
  }
}
```

## Usage

1. Install the plugin in Yaak
2. Start Yaak (the MCP server starts automatically)
3. Configure Claude Desktop with the URL above
4. Restart Claude Desktop
5. In Claude, you can now ask it to use the Yaak tools!

Example: "Use the show_toast tool to display a success message in Yaak"

## Development

```bash
npm install
npm run build
```

## Future Tools

This is a proof of concept with just one tool. Future additions could include:

- List workspaces
- List HTTP requests
- Send HTTP requests
- Manage environments
- Import/export collections
