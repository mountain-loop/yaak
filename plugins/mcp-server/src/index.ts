import { serve } from '@hono/node-server';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { Color, Context, Icon, PluginDefinition } from '@yaakapp/api';
import { Hono } from 'hono';
import * as z from 'zod/v4';

const ICON_VALUES = [
  'alert_triangle',
  'check',
  'check_circle',
  'chevron_down',
  'copy',
  'info',
  'pin',
  'search',
  'trash',
] as const satisfies readonly Icon[];

const COLOR_VALUES = [
  'primary',
  'secondary',
  'danger',
  'warning',
  'notice',
  'success',
  'info',
  'primary',
] as const satisfies readonly Color[];

const serverPort = 64343;

const server = new McpServer({
  name: 'yaak-mcp-server',
  version: '0.1.0',
});

let honoServer: ReturnType<typeof serve> | null = null;

export const plugin: PluginDefinition = {
  async init(ctx: Context) {
    console.log('Initializing MCP Server plugin');

    server.registerTool(
      'show_toast',
      {
        title: 'Show Toast',
        description: 'Show a toast notification in Yaak',
        inputSchema: z.object({
          message: z.string().describe('The message to display'),
          icon: z.enum(ICON_VALUES).optional().describe('Icon'),
          color: z.enum(COLOR_VALUES).optional().describe('Color'),
        }),
      },
      async ({ message, icon }) => {
        console.log('GOT MCP MESSAGE', { message, icon });

        await ctx.toast.show({
          message,
          color: 'success',
          icon: icon || 'info',
        });

        return {
          content: [
            {
              type: 'text',
              text: `✓ Toast shown in Yaak: "${message}"`,
            },
          ],
        };
      },
    );

    // Create a stateless transport (no session management like the official Hono example)
    const transport = new WebStandardStreamableHTTPServerTransport();

    // Create Hono app
    const app = new Hono();

    // MCP endpoint - reuse the same transport for all requests
    app.all('/mcp', (c) => transport.handleRequest(c.req.raw));

    // Connect server to transport BEFORE starting the HTTP server
    await server.connect(transport);

    // Start the server
    console.log('STARTING MCP SERVER', serverPort);
    honoServer = serve({
      fetch: app.fetch,
      port: serverPort,
      hostname: '127.0.0.1',
    });
    console.log(`MCP Server running at http://127.0.0.1:${serverPort}/mcp`);
  },

  async dispose() {
    console.log('Disposing MCP Server plugin');

    if (honoServer) {
      honoServer.close();
      honoServer = null;
    }

    await server.close();
  },
};
