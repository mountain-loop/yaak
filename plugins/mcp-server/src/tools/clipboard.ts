import * as z from 'zod/v4';
import type { McpServerContext } from '../types.js';

export const copyToClipboardTool = {
  name: 'copy_to_clipboard',
  config: {
    title: 'Copy to Clipboard',
    description: 'Copy text to the system clipboard',
    inputSchema: z.object({
      text: z.string().describe('The text to copy'),
    }),
  },
  handler: async ({ text }: { text: string }, ctx: McpServerContext) => {
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
};
