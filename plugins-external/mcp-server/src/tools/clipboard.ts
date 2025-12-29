import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod/v4';
import type { McpServerContext } from '../types.js';

export function registerClipboardTools(server: McpServer, ctx: McpServerContext) {
  server.registerTool(
    'copy_to_clipboard',
    {
      title: 'Copy to Clipboard',
      description: 'Copy text to the system clipboard',
      inputSchema: z.object({
        text: z.string().describe('The text to copy'),
      }),
    },
    async ({ text }) => {
      await ctx.yaak.clipboard.copyText(text);

      return {
        content: [
          {
            type: 'text' as const,
            text: `✓ Copied to clipboard: "${text.substring(0, 100)}${text.length > 100 ? '...' : ''}"`,
          },
        ],
      };
    },
  );
}
