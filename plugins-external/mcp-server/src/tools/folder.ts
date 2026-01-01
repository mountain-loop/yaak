import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod';
import type { McpServerContext } from '../types.js';
import { getWorkspaceContext } from './helpers.js';

export function registerFolderTools(server: McpServer, ctx: McpServerContext) {
  server.registerTool(
    'list_folders',
    {
      title: 'List Folders',
      description: 'List all folders in a workspace',
      inputSchema: z.object({
        workspaceId: z
          .string()
          .optional()
          .describe('Workspace ID (required if multiple workspaces are open)'),
      }),
    },
    async ({ workspaceId }) => {
      const workspaceCtx = await getWorkspaceContext(ctx, workspaceId);
      const folders = await workspaceCtx.yaak.folder.list();

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(folders, null, 2),
          },
        ],
      };
    },
  );
}
