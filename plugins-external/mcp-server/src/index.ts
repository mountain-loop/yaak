import type { Context, PluginDefinition } from '@yaakapp/api';
import { createMcpServer } from './server.js';

const serverPort = 64343;

let mcpServer: Awaited<ReturnType<typeof createMcpServer>> | null = null;

export const plugin: PluginDefinition = {
  async init(ctx: Context) {
    console.log('Initializing MCP Server plugin');

    mcpServer = createMcpServer({ yaak: ctx }, serverPort);
  },

  async dispose() {
    console.log('Disposing MCP Server plugin');

    if (mcpServer) {
      await mcpServer.close();
      mcpServer = null;
    }
  },
};
