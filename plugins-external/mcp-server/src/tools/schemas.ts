import * as z from 'zod';

export const workspaceIdSchema = z
  .string()
  .optional()
  .describe('Workspace ID (required if multiple workspaces are open)');

export const headersSchema = z
  .array(
    z.object({
      name: z.string(),
      value: z.string(),
      enabled: z.boolean().default(true),
    }),
  )
  .optional();

export const urlParametersSchema = z
  .array(
    z.object({
      name: z.string(),
      value: z.string(),
      enabled: z.boolean().default(true),
    }),
  )
  .optional()
  .describe('URL query parameters');

export const bodyTypeSchema = z
  .string()
  .optional()
  .describe(
    'Body type. Supported values: "binary", "graphql", "application/x-www-form-urlencoded", "multipart/form-data", or any text-based type (e.g., "application/json", "text/plain")',
  );

export const bodySchema = z
  .record(z.string(), z.any())
  .optional()
  .describe(
    'Body content object. Structure varies by bodyType:\n' +
      '- "binary": { filePath: "/path/to/file" }\n' +
      '- "graphql": { query: "{ users { name } }", variables: "{\\"id\\": \\"123\\"}" }\n' +
      '- "application/x-www-form-urlencoded": { form: [{ name: "key", value: "val", enabled: true }] }\n' +
      '- "multipart/form-data": { form: [{ name: "field", value: "text", file: "/path/to/file", enabled: true }] }\n' +
      '- text-based (application/json, etc.): { text: "raw body content" }',
  );

export const authenticationTypeSchema = z
  .string()
  .optional()
  .describe(
    'Authentication type. Common values: "basic", "bearer", "oauth2", "apikey", "jwt", "awsv4", "oauth1", "ntlm", "none". Use null to inherit from parent.',
  );

export const authenticationSchema = z
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
  );
