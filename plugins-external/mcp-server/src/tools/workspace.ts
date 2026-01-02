import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpServerContext } from '../types.js';

export function registerWorkspaceTools(server: McpServer, ctx: McpServerContext) {
  server.registerTool(
    'list_workspaces',
    {
      title: 'List Workspaces',
      description: 'List all open workspaces in Yaak',
    },
    async () => {
      const workspaces = await ctx.yaak.workspace.list();

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(workspaces, null, 2),
          },
        ],
      };
    },
  );
}
