import type { Context, PluginDefinition } from '@yaakapp/api';
import { createMcpServer } from './server.js';

const serverPort = 64343;

let mcpServer: Awaited<ReturnType<typeof createMcpServer>> | null = null;

export const plugin: PluginDefinition = {
  async init(ctx: Context) {
    // Start the server after waiting, so there's an active window open to do things
    // like show the startup toast.
    console.log('Initializing MCP Server plugin');
    setTimeout(() => {
      mcpServer = createMcpServer({ yaak: ctx }, serverPort);
    }, 5000);
  },

  async dispose() {
    console.log('Disposing MCP Server plugin');

    if (mcpServer) {
      await mcpServer.close();
      mcpServer = null;
    }
  },
};
