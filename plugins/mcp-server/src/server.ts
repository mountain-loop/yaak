import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import type { McpServerContext } from './types.js';
import * as tools from './tools/index.js';

export function createMcpServer(ctx: McpServerContext, port: number) {
  const server = new McpServer({
    name: 'yaak-mcp-server',
    version: '0.1.0',
  });

  // Register all tools
  const allTools = [
    tools.showToastTool,
    tools.copyToClipboardTool,
    tools.listHttpRequestsTool,
    tools.getHttpRequestTool,
    tools.sendHttpRequestTool,
    tools.listFoldersTool,
    tools.getWorkspaceIdTool,
    tools.getEnvironmentIdTool,
  ];

  for (const tool of allTools) {
    server.registerTool(tool.name, tool.config, (args) => tool.handler(args, ctx));
  }

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
