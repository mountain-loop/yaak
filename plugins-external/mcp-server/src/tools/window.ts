import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpServerContext } from '../types.js';
import { getWorkspaceContext } from './helpers.js';

export function registerWindowTools(server: McpServer, ctx: McpServerContext) {
  server.registerTool(
    'get_workspace_id',
    {
      title: 'Get Workspace ID',
      description: 'Get the current workspace ID',
      inputSchema: {},
    },
    async () => {
      const workspaceCtx = await getWorkspaceContext(ctx);
      const workspaceId = await workspaceCtx.yaak.window.workspaceId();

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
      inputSchema: {},
    },
    async () => {
      const workspaceCtx = await getWorkspaceContext(ctx);
      const environmentId = await workspaceCtx.yaak.window.environmentId();

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
