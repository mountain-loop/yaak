import { StreamableHTTPTransport } from '@hono/mcp';
import { serve } from '@hono/node-server';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Hono } from 'hono';
import { registerFolderTools } from './tools/folder.js';
import { registerHttpRequestTools } from './tools/httpRequest.js';
import { registerToastTools } from './tools/toast.js';
import { registerWindowTools } from './tools/window.js';
import { registerWorkspaceTools } from './tools/workspace.js';
import type { McpServerContext } from './types.js';

export function createMcpServer(ctx: McpServerContext, port: number) {
  console.log('Creating MCP server on port', port);
  const mcpServer = new McpServer({
    name: 'yaak-mcp-server',
    version: '0.1.0',
  });

  // Register all tools
  registerToastTools(mcpServer, ctx);
  registerHttpRequestTools(mcpServer, ctx);
  registerFolderTools(mcpServer, ctx);
  registerWindowTools(mcpServer, ctx);
  registerWorkspaceTools(mcpServer, ctx);

  const app = new Hono();
  const transport = new StreamableHTTPTransport();

  app.all('/mcp', async (c) => {
    if (!mcpServer.isConnected()) {
      // Connect the mcp with the transport
      await mcpServer.connect(transport);
      ctx.yaak.toast.show({
        message: `MCP Server connected`,
        icon: 'info',
        color: 'info',
        timeout: 5000,
      });
    }
    return transport.handleRequest(c);
  });

  const honoServer = serve(
    {
      port,
      hostname: '127.0.0.1',
      fetch: app.fetch,
    },
    (info) => {
      console.log('Started MCP server on ', info.address);
      ctx.yaak.toast.show({
        message: `MCP Server running on http://127.0.0.1:${info.port}`,
        icon: 'info',
        color: 'secondary',
        timeout: 10000,
      });
    },
  );

  return {
    server: mcpServer,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        honoServer.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      await mcpServer.close();
    },
  };
}
