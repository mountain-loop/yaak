import * as z from 'zod/v4';
import type { McpServerContext } from '../types.js';

export const listFoldersTool = {
  name: 'list_folders',
  config: {
    title: 'List Folders',
    description: 'List all folders in the current workspace',
    inputSchema: z.object({}),
  },
  handler: async (_args: Record<string, never>, ctx: McpServerContext) => {
    const folders = await ctx.yaak.folder.list();

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(folders, null, 2),
        },
      ],
    };
  },
};
