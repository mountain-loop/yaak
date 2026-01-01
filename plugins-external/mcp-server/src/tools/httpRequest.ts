import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod';
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

  server.registerTool(
    'create_http_request',
    {
      title: 'Create HTTP Request',
      description: 'Create a new HTTP request',
      inputSchema: z.object({
        workspaceId: z
          .string()
          .optional()
          .describe('Workspace ID (required if multiple workspaces are open)'),
        name: z
          .string()
          .optional()
          .describe('Request name (empty string to auto-generate from URL)'),
        url: z.string().describe('Request URL'),
        method: z.string().optional().describe('HTTP method (defaults to GET)'),
        folderId: z.string().optional().describe('Parent folder ID'),
        description: z.string().optional().describe('Request description'),
        headers: z
          .array(
            z.object({
              name: z.string(),
              value: z.string(),
              enabled: z.boolean().default(true),
            }),
          )
          .optional()
          .describe('Request headers'),
        urlParameters: z
          .array(
            z.object({
              name: z.string(),
              value: z.string(),
              enabled: z.boolean().default(true),
            }),
          )
          .optional()
          .describe('URL query parameters'),
        bodyType: z
          .string()
          .optional()
          .describe(
            'Body type. Supported values: "binary", "graphql", "application/x-www-form-urlencoded", "multipart/form-data", or any text-based type (e.g., "application/json", "text/plain")',
          ),
        body: z
          .record(z.string(), z.any())
          .optional()
          .describe(
            'Body content object. Structure varies by bodyType:\n' +
              '- "binary": { filePath: "/path/to/file" }\n' +
              '- "graphql": { query: "{ users { name } }", variables: "{\\"id\\": \\"123\\"}" }\n' +
              '- "application/x-www-form-urlencoded": { form: [{ name: "key", value: "val", enabled: true }] }\n' +
              '- "multipart/form-data": { form: [{ name: "field", value: "text", file: "/path/to/file", enabled: true }] }\n' +
              '- text-based (application/json, etc.): { text: "raw body content" }',
          ),
        authenticationType: z
          .string()
          .optional()
          .describe(
            'Authentication type. Common values: "basic", "bearer", "oauth2", "apikey", "jwt", "awsv4", "oauth1", "ntlm", "none". Use null to inherit from parent folder/workspace.',
          ),
        authentication: z
          .record(z.string(), z.any())
          .optional()
          .describe(
            'Authentication configuration object. Structure varies by authenticationType:\n' +
              '- "basic": { username: "user", password: "pass" }\n' +
              '- "bearer": { token: "abc123", prefix: "Bearer" }\n' +
              '- "oauth2": { clientId: "...", clientSecret: "...", grantType: "authorization_code", authorizationUrl: "...", accessTokenUrl: "...", scope: "...", ... }\n' +
              '- "apikey": { location: "header" | "query", key: "X-API-Key", value: "..." }\n' +
              '- "jwt": { algorithm: "HS256", secret: "...", payload: "{ ... }" }\n' +
              '- "awsv4": { accessKeyId: "...", secretAccessKey: "...", service: "sts", region: "us-east-1", sessionToken: "..." }\n' +
              '- "none": {}',
          ),
      }),
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
      inputSchema: z.object({
        id: z.string().describe('HTTP request ID to update'),
        workspaceId: z.string().describe('Workspace ID'),
        name: z.string().optional().describe('Request name'),
        url: z.string().optional().describe('Request URL'),
        method: z.string().optional().describe('HTTP method'),
        folderId: z.string().optional().describe('Parent folder ID'),
        description: z.string().optional().describe('Request description'),
        headers: z
          .array(
            z.object({
              name: z.string(),
              value: z.string(),
              enabled: z.boolean().default(true),
            }),
          )
          .optional()
          .describe('Request headers'),
        urlParameters: z
          .array(
            z.object({
              name: z.string(),
              value: z.string(),
              enabled: z.boolean().default(true),
            }),
          )
          .optional()
          .describe('URL query parameters'),
        bodyType: z
          .string()
          .optional()
          .describe(
            'Body type. Supported values: "binary", "graphql", "application/x-www-form-urlencoded", "multipart/form-data", or any text-based type (e.g., "application/json", "text/plain")',
          ),
        body: z
          .record(z.string(), z.any())
          .optional()
          .describe(
            'Body content object. Structure varies by bodyType:\n' +
              '- "binary": { filePath: "/path/to/file" }\n' +
              '- "graphql": { query: "{ users { name } }", variables: "{\\"id\\": \\"123\\"}" }\n' +
              '- "application/x-www-form-urlencoded": { form: [{ name: "key", value: "val", enabled: true }] }\n' +
              '- "multipart/form-data": { form: [{ name: "field", value: "text", file: "/path/to/file", enabled: true }] }\n' +
              '- text-based (application/json, etc.): { text: "raw body content" }',
          ),
        authenticationType: z
          .string()
          .optional()
          .describe(
            'Authentication type. Common values: "basic", "bearer", "oauth2", "apikey", "jwt", "awsv4", "oauth1", "ntlm", "none". Use null to inherit from parent folder/workspace.',
          ),
        authentication: z
          .record(z.string(), z.any())
          .optional()
          .describe(
            'Authentication configuration object. Structure varies by authenticationType:\n' +
              '- "basic": { username: "user", password: "pass" }\n' +
              '- "bearer": { token: "abc123", prefix: "Bearer" }\n' +
              '- "oauth2": { clientId: "...", clientSecret: "...", grantType: "authorization_code", authorizationUrl: "...", accessTokenUrl: "...", scope: "...", ... }\n' +
              '- "apikey": { location: "header" | "query", key: "X-API-Key", value: "..." }\n' +
              '- "jwt": { algorithm: "HS256", secret: "...", payload: "{ ... }" }\n' +
              '- "awsv4": { accessKeyId: "...", secretAccessKey: "...", service: "sts", region: "us-east-1", sessionToken: "..." }\n' +
              '- "none": {}',
          ),
      }),
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
      inputSchema: z.object({
        id: z.string().describe('HTTP request ID to delete'),
      }),
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
