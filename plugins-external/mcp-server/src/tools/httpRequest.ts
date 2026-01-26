import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod';
import type { McpServerContext } from '../types.js';
import { getWorkspaceContext } from './helpers.js';
import {
  authenticationSchema,
  authenticationTypeSchema,
  bodySchema,
  bodyTypeSchema,
  headersSchema,
  urlParametersSchema,
  workspaceIdSchema,
} from './schemas.js';

export function registerHttpRequestTools(server: McpServer, ctx: McpServerContext) {
  server.registerTool(
    'list_http_requests',
    {
      title: 'List HTTP Requests',
      description: 'List all HTTP requests in a workspace',
      inputSchema: {
        workspaceId: workspaceIdSchema,
      },
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
      inputSchema: {
        id: z.string().describe('The HTTP request ID'),
        workspaceId: workspaceIdSchema,
      },
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
      inputSchema: {
        id: z.string().describe('The HTTP request ID to send'),
        environmentId: z.string().optional().describe('Optional environment ID to use'),
        workspaceId: workspaceIdSchema,
      },
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

  server.registerTool(
    'create_http_request',
    {
      title: 'Create HTTP Request',
      description: 'Create a new HTTP request',
      inputSchema: {
        workspaceId: workspaceIdSchema,
        name: z
          .string()
          .optional()
          .describe('Request name (empty string to auto-generate from URL)'),
        url: z.string().describe('Request URL'),
        method: z.string().optional().describe('HTTP method (defaults to GET)'),
        folderId: z.string().optional().describe('Parent folder ID'),
        description: z.string().optional().describe('Request description'),
        headers: headersSchema.describe('Request headers'),
        urlParameters: urlParametersSchema,
        bodyType: bodyTypeSchema,
        body: bodySchema,
        authenticationType: authenticationTypeSchema,
        authentication: authenticationSchema,
      },
    },
    async ({ workspaceId: ogWorkspaceId, ...args }) => {
      const workspaceCtx = await getWorkspaceContext(ctx, ogWorkspaceId);
      const workspaceId = await workspaceCtx.yaak.window.workspaceId();
      if (!workspaceId) {
        throw new Error('No workspace is open');
      }

      const httpRequest = await workspaceCtx.yaak.httpRequest.create({
        workspaceId: workspaceId,
        ...args,
      });

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(httpRequest, null, 2) }],
      };
    },
  );

  server.registerTool(
    'update_http_request',
    {
      title: 'Update HTTP Request',
      description: 'Update an existing HTTP request',
      inputSchema: {
        id: z.string().describe('HTTP request ID to update'),
        workspaceId: workspaceIdSchema,
        name: z.string().optional().describe('Request name'),
        url: z.string().optional().describe('Request URL'),
        method: z.string().optional().describe('HTTP method'),
        folderId: z.string().optional().describe('Parent folder ID'),
        description: z.string().optional().describe('Request description'),
        headers: headersSchema.describe('Request headers'),
        urlParameters: urlParametersSchema,
        bodyType: bodyTypeSchema,
        body: bodySchema,
        authenticationType: authenticationTypeSchema,
        authentication: authenticationSchema,
      },
    },
    async ({ id, workspaceId, ...updates }) => {
      const workspaceCtx = await getWorkspaceContext(ctx, workspaceId);
      // Fetch existing request to merge with updates
      const existing = await workspaceCtx.yaak.httpRequest.getById({ id });
      if (!existing) {
        throw new Error(`HTTP request with ID ${id} not found`);
      }
      // Merge existing fields with updates
      const httpRequest = await workspaceCtx.yaak.httpRequest.update({
        ...existing,
        ...updates,
        id,
      });
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(httpRequest, null, 2) }],
      };
    },
  );

  server.registerTool(
    'delete_http_request',
    {
      title: 'Delete HTTP Request',
      description: 'Delete an HTTP request by ID',
      inputSchema: {
        id: z.string().describe('HTTP request ID to delete'),
      },
    },
    async ({ id }) => {
      const httpRequest = await ctx.yaak.httpRequest.delete({ id });
      return {
        content: [
          { type: 'text' as const, text: `Deleted: ${httpRequest.name} (${httpRequest.id})` },
        ],
      };
    },
  );
}
