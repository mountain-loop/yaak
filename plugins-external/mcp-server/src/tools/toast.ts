import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Color, Icon } from '@yaakapp/api';
import * as z from 'zod';
import type { McpServerContext } from '../types.js';

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
  'info',
  'success',
  'notice',
  'warning',
  'danger',
] as const satisfies readonly Color[];

export function registerToastTools(server: McpServer, ctx: McpServerContext) {
  server.registerTool(
    'show_toast',
    {
      title: 'Show Toast',
      description: 'Show a toast notification in Yaak',
      inputSchema: {
        message: z.string().describe('The message to display'),
        icon: z.enum(ICON_VALUES).optional().describe('Icon name'),
        color: z.enum(COLOR_VALUES).optional().describe('Toast color'),
        timeout: z.number().optional().describe('Timeout in milliseconds'),
      },
    },
    async ({ message, icon, color, timeout }) => {
      await ctx.yaak.toast.show({
        message,
        icon,
        color,
        timeout,
      });

      return {
        content: [
          {
            type: 'text' as const,
            text: `✓ Toast shown: "${message}"`,
          },
        ],
      };
    },
  );
}
