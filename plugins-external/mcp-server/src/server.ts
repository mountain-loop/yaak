import { serve } from '@hono/node-server';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { Hono } from 'hono';
import { registerFolderTools } from './tools/folder.js';
import { registerHttpRequestTools } from './tools/httpRequest.js';
import { registerToastTools } from './tools/toast.js';
import { registerWindowTools } from './tools/window.js';
import { registerWorkspaceTools } from './tools/workspace.js';
import type { McpServerContext } from './types.js';

export function createMcpServer(ctx: McpServerContext, port: number) {
  const server = new McpServer({
    name: 'yaak-mcp-server',
    version: '0.1.0',
  });

  // Register all tools
  registerToastTools(server, ctx);
  registerHttpRequestTools(server, ctx);
  registerFolderTools(server, ctx);
  registerWindowTools(server, ctx);
  registerWorkspaceTools(server, ctx);

  // Create a stateless transport
  const transport = new WebStandardStreamableHTTPServerTransport();

  // Create Hono app
  const app = new Hono();

  // MCP endpoint - reuse the same transport for all requests
  app.all('/mcp', (c) => transport.handleRequest(c.req.raw));

  // Connect server to transport
  server.connect(transport).then(() => {
    console.log(`MCP Server running at http://127.0.0.1:${port}/mcp`);
  });

  // Start the HTTP server
  const honoServer = serve({
    fetch: app.fetch,
    port,
    hostname: '127.0.0.1',
  });

  return {
    server,
    close: async () => {
      honoServer.close();
      await server.close();
    },
  };
}
