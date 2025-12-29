import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod/v4';
import type { McpServerContext } from '../types.js';

export function registerWindowTools(server: McpServer, ctx: McpServerContext) {
  server.registerTool(
    'get_workspace_id',
    {
      title: 'Get Workspace ID',
      description: 'Get the current workspace ID',
      inputSchema: z.object({}),
    },
    async () => {
      const workspaceId = await ctx.yaak.window.workspaceId();

      return {
        content: [
          {
            type: 'text' as const,
            text: workspaceId || 'No workspace open',
          },
        ],
      };
    },
  );

  server.registerTool(
    'get_environment_id',
    {
      title: 'Get Environment ID',
      description: 'Get the current environment ID',
      inputSchema: z.object({}),
    },
    async () => {
      const environmentId = await ctx.yaak.window.environmentId();

      return {
        content: [
          {
            type: 'text' as const,
            text: environmentId || 'No environment selected',
          },
        ],
      };
    },
  );
}
