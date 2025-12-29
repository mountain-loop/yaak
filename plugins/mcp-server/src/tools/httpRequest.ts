import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod/v4';
import type { McpServerContext } from '../types.js';
import { getWorkspaceContext } from './helpers.js';

export function registerHttpRequestTools(server: McpServer, ctx: McpServerContext) {
  server.registerTool(
    'list_http_requests',
    {
      title: 'List HTTP Requests',
      description: 'List all HTTP requests in a workspace',
      inputSchema: z.object({
        workspaceId: z
          .string()
          .optional()
          .describe('Workspace ID (required if multiple workspaces are open)'),
      }),
    },
    async ({ workspaceId }) => {
      const workspaceCtx = await getWorkspaceContext(ctx, workspaceId);
      const requests = await workspaceCtx.yaak.httpRequest.list();

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(requests, null, 2),
          },
        ],
      };
    },
  );

  server.registerTool(
    'get_http_request',
    {
      title: 'Get HTTP Request',
      description: 'Get details of a specific HTTP request by ID',
      inputSchema: z.object({
        id: z.string().describe('The HTTP request ID'),
        workspaceId: z
          .string()
          .optional()
          .describe('Workspace ID (required if multiple workspaces are open)'),
      }),
    },
    async ({ id, workspaceId }) => {
      const workspaceCtx = await getWorkspaceContext(ctx, workspaceId);
      const request = await workspaceCtx.yaak.httpRequest.getById({ id });

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(request, null, 2),
          },
        ],
      };
    },
  );

  server.registerTool(
    'send_http_request',
    {
      title: 'Send HTTP Request',
      description: 'Send an HTTP request and get the response',
      inputSchema: z.object({
        id: z.string().describe('The HTTP request ID to send'),
        environmentId: z.string().optional().describe('Optional environment ID to use'),
        workspaceId: z
          .string()
          .optional()
          .describe('Workspace ID (required if multiple workspaces are open)'),
      }),
    },
    async ({ id, workspaceId }) => {
      const workspaceCtx = await getWorkspaceContext(ctx, workspaceId);
      const httpRequest = await workspaceCtx.yaak.httpRequest.getById({ id });
      if (httpRequest == null) {
        throw new Error(`HTTP request with ID ${id} not found`);
      }

      const response = await workspaceCtx.yaak.httpRequest.send({ httpRequest });

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(response, null, 2),
          },
        ],
      };
    },
  );
}
