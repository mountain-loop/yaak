import * as z from 'zod/v4';
import type { McpServerContext } from '../types.js';

export const listHttpRequestsTool = {
  name: 'list_http_requests',
  config: {
    title: 'List HTTP Requests',
    description: 'List all HTTP requests in the current workspace',
    inputSchema: z.object({}),
  },
  handler: async (_args: Record<string, never>, ctx: McpServerContext) => {
    const requests = await ctx.yaak.httpRequest.list();

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(requests, null, 2),
        },
      ],
    };
  },
};

export const getHttpRequestTool = {
  name: 'get_http_request',
  config: {
    title: 'Get HTTP Request',
    description: 'Get details of a specific HTTP request by ID',
    inputSchema: z.object({
      id: z.string().describe('The HTTP request ID'),
    }),
  },
  handler: async ({ id }: { id: string }, ctx: McpServerContext) => {
    const request = await ctx.yaak.httpRequest.getById({ id });

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(request, null, 2),
        },
      ],
    };
  },
};

export const sendHttpRequestTool = {
  name: 'send_http_request',
  config: {
    title: 'Send HTTP Request',
    description: 'Send an HTTP request and get the response',
    inputSchema: z.object({
      id: z.string().describe('The HTTP request ID to send'),
    }),
  },
  handler: async ({ id }: { id: string }, ctx: McpServerContext) => {
    const httpRequest = await ctx.yaak.httpRequest.getById({ id });
    if (httpRequest == null) {
      throw new Error(`HTTP request with ID ${id} not found`);
    }

    const response = await ctx.yaak.httpRequest.send({ httpRequest });

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(response, null, 2),
        },
      ],
    };
  },
};
