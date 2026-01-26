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
      inputSchema: {
        workspaceId: z
          .string()
          .optional()
          .describe('Workspace ID (required if multiple workspaces are open)'),
      },
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

  server.registerTool(
    'get_folder',
    {
      title: 'Get Folder',
      description: 'Get details of a specific folder by ID',
      inputSchema: {
        id: z.string().describe('The folder ID'),
        workspaceId: z
          .string()
          .optional()
          .describe('Workspace ID (required if multiple workspaces are open)'),
      },
    },
    async ({ id, workspaceId }) => {
      const workspaceCtx = await getWorkspaceContext(ctx, workspaceId);
      const folder = await workspaceCtx.yaak.folder.getById({ id });

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(folder, null, 2),
          },
        ],
      };
    },
  );

  server.registerTool(
    'create_folder',
    {
      title: 'Create Folder',
      description: 'Create a new folder in a workspace',
      inputSchema: {
        workspaceId: z
          .string()
          .optional()
          .describe('Workspace ID (required if multiple workspaces are open)'),
        name: z.string().describe('Folder name'),
        folderId: z.string().optional().describe('Parent folder ID (for nested folders)'),
        description: z.string().optional().describe('Folder description'),
        sortPriority: z.number().optional().describe('Sort priority for ordering'),
        headers: z
          .array(
            z.object({
              name: z.string(),
              value: z.string(),
              enabled: z.boolean().default(true),
            }),
          )
          .optional()
          .describe('Default headers to apply to requests in this folder'),
        authenticationType: z
          .string()
          .optional()
          .describe(
            'Authentication type. Common values: "basic", "bearer", "oauth2", "apikey", "jwt", "awsv4", "oauth1", "ntlm", "none". Use null to inherit from parent.',
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
      },
    },
    async ({ workspaceId: ogWorkspaceId, ...args }) => {
      const workspaceCtx = await getWorkspaceContext(ctx, ogWorkspaceId);
      const workspaceId = await workspaceCtx.yaak.window.workspaceId();
      if (!workspaceId) {
        throw new Error('No workspace is open');
      }

      const folder = await workspaceCtx.yaak.folder.create({
        workspaceId: workspaceId,
        ...args,
      });

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(folder, null, 2) }],
      };
    },
  );

  server.registerTool(
    'update_folder',
    {
      title: 'Update Folder',
      description: 'Update an existing folder',
      inputSchema: {
        id: z.string().describe('Folder ID to update'),
        workspaceId: z
          .string()
          .optional()
          .describe('Workspace ID (required if multiple workspaces are open)'),
        name: z.string().optional().describe('Folder name'),
        folderId: z.string().optional().describe('Parent folder ID (for nested folders)'),
        description: z.string().optional().describe('Folder description'),
        sortPriority: z.number().optional().describe('Sort priority for ordering'),
        headers: z
          .array(
            z.object({
              name: z.string(),
              value: z.string(),
              enabled: z.boolean().default(true),
            }),
          )
          .optional()
          .describe('Default headers to apply to requests in this folder'),
        authenticationType: z
          .string()
          .optional()
          .describe(
            'Authentication type. Common values: "basic", "bearer", "oauth2", "apikey", "jwt", "awsv4", "oauth1", "ntlm", "none". Use null to inherit from parent.',
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
      },
    },
    async ({ id, workspaceId, ...updates }) => {
      const workspaceCtx = await getWorkspaceContext(ctx, workspaceId);
      // Fetch existing folder to merge with updates
      const existing = await workspaceCtx.yaak.folder.getById({ id });
      if (!existing) {
        throw new Error(`Folder with ID ${id} not found`);
      }
      // Merge existing fields with updates
      const folder = await workspaceCtx.yaak.folder.update({
        ...existing,
        ...updates,
        id,
      });
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(folder, null, 2) }],
      };
    },
  );

  server.registerTool(
    'delete_folder',
    {
      title: 'Delete Folder',
      description: 'Delete a folder by ID',
      inputSchema: {
        id: z.string().describe('Folder ID to delete'),
      },
    },
    async ({ id }) => {
      const folder = await ctx.yaak.folder.delete({ id });
      return {
        content: [{ type: 'text' as const, text: `Deleted: ${folder.name} (${folder.id})` }],
      };
    },
  );
}
