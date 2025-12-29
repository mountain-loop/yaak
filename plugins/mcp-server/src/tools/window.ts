import * as z from 'zod/v4';
import type { McpServerContext } from '../types.js';

export const getWorkspaceIdTool = {
  name: 'get_workspace_id',
  config: {
    title: 'Get Workspace ID',
    description: 'Get the current workspace ID',
    inputSchema: z.object({}),
  },
  handler: async (_args: Record<string, never>, ctx: McpServerContext) => {
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
};

export const getEnvironmentIdTool = {
  name: 'get_environment_id',
  config: {
    title: 'Get Environment ID',
    description: 'Get the current environment ID',
    inputSchema: z.object({}),
  },
  handler: async (_args: Record<string, never>, ctx: McpServerContext) => {
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
};
