import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, test } from "vite-plus/test";
import { convertOpenApi } from "../src";

describe("importer-openapi", () => {
  const p = path.join(__dirname, "fixtures");
  const fixtures = fs.readdirSync(p).filter((fixture) => {
    return fs.statSync(path.join(p, fixture)).isFile();
  });
  const realWorldFixturesPath = path.join(p, "real-world");
  const realWorldFixtures = fs
    .readdirSync(realWorldFixturesPath)
    .filter((fixture) => fixture.endsWith(".yaml"));

  test("Imports OpenAPI 3.2 QUERY and additional operations", async () => {
    const imported = await convertOpenApi(
      JSON.stringify({
        openapi: "3.2.0",
        info: { title: "OpenAPI 3.2 Operations", version: "1.0.0" },
        paths: {
          "/resources": {
            query: { summary: "Query resources", responses: {} },
            additionalOperations: {
              COPY: { summary: "Copy resources", responses: {} },
            },
          },
        },
      }),
    );

    expect(imported?.resources.httpRequests).toEqual([
      expect.objectContaining({
        method: "QUERY",
        name: "Query resources",
        url: "${[baseUrl]}/resources",
      }),
      expect.objectContaining({
        method: "COPY",
        name: "Copy resources",
        url: "${[baseUrl]}/resources",
      }),
    ]);
  });

  test("Maps operation description to request description", async () => {
    const imported = await convertOpenApi(
      JSON.stringify({
        openapi: "3.0.0",
        info: { title: "Description Test", version: "1.0.0" },
        paths: {
          "/klanten": {
            get: {
              description: "Lijst van klanten",
              responses: { "200": { description: "ok" } },
            },
          },
        },
      }),
    );

    expect(imported?.resources.httpRequests).toEqual([
      expect.objectContaining({
        description: expect.stringContaining("Lijst van klanten"),
      }),
    ]);
  });

  test("Imports requests directly from OpenAPI details", async () => {
    const imported = await convertOpenApi(
      JSON.stringify({
        openapi: "3.0.0",
        info: { title: "Native Import Test", version: "1.0.0" },
        servers: [
          { url: "https://api.example.com/{version}", variables: { version: { default: "v1" } } },
        ],
        tags: [{ name: "accounts", description: "Account operations" }],
        paths: {
          "/accounts/{accountId}/members": {
            parameters: [
              {
                name: "accountId",
                in: "path",
                required: true,
                description: "Account identifier",
                schema: { type: "string", example: "acct_123" },
              },
            ],
            post: {
              tags: ["accounts"],
              summary: "Create member",
              operationId: "createMember",
              parameters: [
                {
                  name: "include",
                  in: "query",
                  description: "Related resources to include",
                  schema: { type: "string", enum: ["roles"] },
                },
                {
                  name: "X-Trace-Id",
                  in: "header",
                  schema: { type: "string", example: "trace-123" },
                },
              ],
              security: [{ tokenAuth: [] }],
              requestBody: {
                description: "Member payload",
                content: {
                  "application/json": {
                    schema: { $ref: "#/components/schemas/MemberInput" },
                  },
                },
              },
              responses: {
                "201": { description: "Created" },
              },
            },
          },
        },
        components: {
          securitySchemes: {
            tokenAuth: { type: "http", scheme: "bearer" },
          },
          schemas: {
            MemberInput: {
              type: "object",
              required: ["email"],
              properties: {
                email: { type: "string", example: "me@example.com" },
                admin: { type: "boolean", default: false },
                primaryContact: { $ref: "#/components/schemas/Contact" },
                secondaryContact: { $ref: "#/components/schemas/Contact" },
              },
            },
            Contact: {
              type: "object",
              properties: {
                name: { type: "string", example: "Taylor" },
              },
            },
          },
        },
      }),
    );

    expect(imported?.resources.folders).toEqual([
      expect.objectContaining({ name: "accounts", description: "Account operations" }),
    ]);
    expect(imported?.resources.environments).toEqual([
      expect.objectContaining({
        name: "Global Variables",
        variables: [],
      }),
      expect.objectContaining({
        name: "Server 1",
        parentModel: "environment",
        variables: [
          { name: "baseUrl", value: "https://api.example.com/v1" },
          { name: "auth_token_auth_token", value: "" },
        ],
      }),
    ]);
    expect(imported?.resources.httpRequests).toEqual([
      expect.objectContaining({
        name: "Create member",
        method: "POST",
        url: "${[baseUrl]}/accounts/:accountId/members",
        authenticationType: "bearer",
        authentication: { token: "${[auth_token_auth_token]}", prefix: "Bearer" },
        bodyType: "application/json",
        body: {
          text: JSON.stringify(
            {
              email: "me@example.com",
              admin: false,
              primaryContact: { name: "Taylor" },
              secondaryContact: { name: "Taylor" },
            },
            null,
            2,
          ),
        },
        headers: expect.arrayContaining([
          { enabled: false, name: "X-Trace-Id", value: "trace-123" },
          { enabled: true, name: "Content-Type", value: "application/json" },
        ]),
        urlParameters: [
          { enabled: true, name: ":accountId", value: "acct_123" },
          { enabled: false, name: "include", value: "roles" },
        ],
        description: expect.stringContaining("Operation ID: createMember"),
      }),
    ]);
    expect(imported?.resources.httpRequests[0]?.description).toContain("Member payload");
    expect(imported?.resources.httpRequests[0]?.description).toContain("201: Created");
  });

  test("Handles large schemas without the Postman converter path", async () => {
    const paths: Record<string, unknown> = {};
    for (let i = 0; i < 500; i++) {
      paths[`/zones/{zoneId}/resources/${i}`] = {
        get: {
          tags: ["zones"],
          summary: `Read resource ${i}`,
          parameters: [
            { name: "zoneId", in: "path", required: true, schema: { type: "string" } },
            { name: "page", in: "query", schema: { type: "integer", default: 1 } },
          ],
          responses: {
            "200": {
              description: "OK",
              content: {
                "application/json": { schema: { $ref: "#/components/schemas/Resource" } },
              },
            },
          },
        },
      };
    }

    const imported = await convertOpenApi(
      JSON.stringify({
        openapi: "3.1.0",
        info: { title: "Large API", version: "1.0.0" },
        servers: [{ url: "https://api.example.com/client/v4" }],
        tags: [{ name: "zones" }],
        paths,
        components: {
          schemas: {
            Resource: {
              type: "object",
              properties: {
                id: { type: "string" },
                name: { type: "string" },
                metadata: { $ref: "#/components/schemas/Metadata" },
              },
            },
            Metadata: {
              type: "object",
              properties: {
                createdOn: { type: "string", format: "date-time" },
                tags: { type: "array", items: { type: "string" } },
              },
            },
          },
        },
      }),
    );

    expect(imported?.resources.httpRequests.length).toBe(500);
    expect(imported?.resources.httpRequests[499]).toEqual(
      expect.objectContaining({
        name: "Read resource 499",
        url: "${[baseUrl]}/zones/:zoneId/resources/499",
      }),
    );
    expect(imported?.resources.environments).toEqual([
      expect.objectContaining({
        name: "Global Variables",
        variables: [],
      }),
      expect.objectContaining({
        name: "Server 1",
        variables: [{ name: "baseUrl", value: "https://api.example.com/client/v4" }],
      }),
    ]);
  });

  test("Skips invalid file", async () => {
    const imported = await convertOpenApi("{}");
    expect(imported).toBeUndefined();
  });

  test("Creates an editable baseUrl variable when OpenAPI omits servers", async () => {
    const imported = await convertOpenApi(
      JSON.stringify({
        openapi: "3.0.4",
        info: { title: "Serverless OpenAPI Test", version: "1.0.0" },
        paths: {
          "/api/widgets": { get: { responses: {} } },
        },
      }),
    );

    expect(imported?.resources.environments).toEqual([
      expect.objectContaining({
        name: "Global Variables",
        variables: [],
      }),
      expect.objectContaining({
        name: "Default",
        parentModel: "environment",
        variables: [{ name: "baseUrl", value: "" }],
      }),
    ]);
    expect(imported?.resources.httpRequests[0]?.url).toBe("${[baseUrl]}/api/widgets");
  });

  test("Prefers operation and path servers over the spec base URL", async () => {
    const imported = await convertOpenApi(
      JSON.stringify({
        openapi: "3.0.0",
        info: { title: "Servers Test", version: "1.0.0" },
        servers: [{ url: "https://root.example.com" }],
        paths: {
          "/root": { get: { responses: {} } },
          "/path-level": {
            servers: [{ url: "https://path.example.com" }],
            get: { responses: {} },
          },
          "/operation-level": {
            servers: [{ url: "https://path.example.com" }],
            get: { servers: [{ url: "https://operation.example.com" }], responses: {} },
          },
        },
      }),
    );

    expect(imported?.resources.httpRequests.map((r) => r.url)).toEqual([
      "${[baseUrl]}/root",
      "${[serverUrl]}/path-level",
      "${[serverUrl2]}/operation-level",
    ]);
    expect(imported?.resources.environments).toEqual([
      expect.objectContaining({
        name: "Global Variables",
        variables: [
          { name: "serverUrl", value: "https://path.example.com" },
          { name: "serverUrl2", value: "https://operation.example.com" },
        ],
      }),
      expect.objectContaining({
        name: "Server 1",
        variables: [{ name: "baseUrl", value: "https://root.example.com" }],
      }),
    ]);
  });

  test("Creates selectable environments for multiple OpenAPI servers", async () => {
    const imported = await convertOpenApi(
      JSON.stringify({
        openapi: "3.0.4",
        info: { title: "Server Environments Test", version: "1.0.0" },
        servers: [
          { url: "https://api.example.com/v1", description: "Production" },
          { url: "https://sandbox.example.com/v1", description: "Sandbox" },
        ],
        paths: {
          "/oauth": { get: { security: [{ oauth: [] }], responses: {} } },
          "/api-key": { get: { security: [{ apiKey: [] }], responses: {} } },
          "/fixed": {
            servers: [{ url: "https://fixed.example.com" }],
            get: { responses: {} },
          },
        },
        components: {
          securitySchemes: {
            oauth: {
              type: "oauth2",
              flows: {
                authorizationCode: {
                  authorizationUrl: "/oauth/authorize",
                  tokenUrl: "oauth/token",
                  scopes: {},
                },
              },
            },
            apiKey: { type: "apiKey", in: "header", name: "X-API-Key" },
          },
        },
      }),
    );

    expect(imported?.resources.environments).toEqual([
      expect.objectContaining({
        name: "Global Variables",
        variables: [{ name: "serverUrl", value: "https://fixed.example.com" }],
      }),
      expect.objectContaining({
        name: "Production",
        parentModel: "environment",
        variables: [
          { name: "baseUrl", value: "https://api.example.com/v1" },
          { name: "oauth_client_id", value: "" },
          { name: "oauth_client_secret", value: "" },
          { name: "baseUrlOrigin", value: "https://api.example.com" },
          { name: "auth_api_key_key", value: "" },
        ],
      }),
      expect.objectContaining({
        name: "Sandbox",
        parentModel: "environment",
        variables: [
          { name: "baseUrl", value: "https://sandbox.example.com/v1" },
          { name: "oauth_client_id", value: "" },
          { name: "oauth_client_secret", value: "" },
          { name: "baseUrlOrigin", value: "https://sandbox.example.com" },
          { name: "auth_api_key_key", value: "" },
        ],
      }),
    ]);
    expect(imported?.resources.httpRequests[0]?.authentication).toEqual(
      expect.objectContaining({
        authorizationUrl: "${[baseUrlOrigin]}/oauth/authorize",
        accessTokenUrl: "${[baseUrl]}/oauth/token",
      }),
    );
  });

  test("Creates variables for path servers without a top-level server", async () => {
    const imported = await convertOpenApi(
      JSON.stringify({
        openapi: "3.0.4",
        info: { title: "Path Server Test", version: "1.0.0" },
        paths: {
          "/items": {
            servers: [{ url: "https://path.example.com" }],
            get: { responses: {} },
          },
        },
      }),
    );

    expect(imported?.resources.httpRequests[0]?.url).toBe("${[serverUrl]}/items");
    expect(imported?.resources.environments).toEqual([
      expect.objectContaining({
        name: "Global Variables",
        variables: [{ name: "serverUrl", value: "https://path.example.com" }],
      }),
      expect.objectContaining({
        name: "Default",
        variables: [{ name: "baseUrl", value: "" }],
      }),
    ]);
  });

  test("Imports OpenAPI 3 OAuth2 flows", async () => {
    const imported = await convertOpenApi(
      JSON.stringify({
        openapi: "3.0.0",
        info: { title: "OAuth Test", version: "1.0.0" },
        paths: {
          "/a": { get: { security: [{ oauth: ["read", "write"] }], responses: {} } },
          "/b": { get: { security: [{ implicitOauth: [] }], responses: {} } },
        },
        components: {
          securitySchemes: {
            oauth: {
              type: "oauth2",
              flows: {
                clientCredentials: { tokenUrl: "https://example.com/token", scopes: {} },
              },
            },
            implicitOauth: {
              type: "oauth2",
              flows: {
                implicit: { authorizationUrl: "https://example.com/authorize", scopes: {} },
              },
            },
          },
        },
      }),
    );

    expect(imported?.resources.httpRequests[0]).toEqual(
      expect.objectContaining({
        authenticationType: "oauth2",
        authentication: {
          grantType: "client_credentials",
          clientId: "${[oauth_oauth_client_id]}",
          clientSecret: "${[oauth_oauth_client_secret]}",
          headerPrefix: "Bearer",
          scope: "read write",
          accessTokenUrl: "https://example.com/token",
        },
      }),
    );
    expect(imported?.resources.httpRequests[1]).toEqual(
      expect.objectContaining({
        authenticationType: "oauth2",
        authentication: {
          grantType: "implicit",
          clientId: "${[oauth_implicitOauth_client_id]}",
          headerPrefix: "Bearer",
          authorizationUrl: "https://example.com/authorize",
        },
      }),
    );
    expect(imported?.resources.environments[0]?.variables).toEqual([]);
    expect(imported?.resources.environments[1]).toEqual(
      expect.objectContaining({
        name: "Default",
        variables: [
          { name: "baseUrl", value: "" },
          { name: "oauth_oauth_client_id", value: "" },
          { name: "oauth_oauth_client_secret", value: "" },
          { name: "oauth_implicitOauth_client_id", value: "" },
          { name: "oauth_implicitOauth_client_secret", value: "" },
        ],
      }),
    );
  });

  test("Uses server environment variables for OAuth2 client credentials", async () => {
    const imported = await convertOpenApi(
      JSON.stringify({
        openapi: "3.0.4",
        info: { title: "OAuth Environment Test", version: "1.0.0" },
        servers: [{ url: "https://api.example.com" }],
        paths: {
          "/users": {
            get: { security: [{ oauth: ["read"] }], responses: {} },
            post: { security: [{ oauth: ["write"] }], responses: {} },
          },
        },
        components: {
          securitySchemes: {
            oauth: {
              type: "oauth2",
              flows: {
                authorizationCode: {
                  authorizationUrl: "/oauth/authorize",
                  tokenUrl: "/oauth/token",
                  scopes: { read: "Read users", write: "Write users" },
                },
              },
            },
          },
        },
      }),
    );

    expect(imported?.resources.environments).toEqual([
      expect.objectContaining({ name: "Global Variables", variables: [] }),
      expect.objectContaining({
        name: "Server 1",
        variables: [
          { name: "baseUrl", value: "https://api.example.com" },
          { name: "oauth_client_id", value: "" },
          { name: "oauth_client_secret", value: "" },
        ],
      }),
    ]);
    expect(imported?.resources.httpRequests.map((request) => request.authentication)).toEqual([
      expect.objectContaining({
        clientId: "${[oauth_client_id]}",
        clientSecret: "${[oauth_client_secret]}",
        authorizationUrl: "https://api.example.com/oauth/authorize",
        accessTokenUrl: "https://api.example.com/oauth/token",
      }),
      expect.objectContaining({
        clientId: "${[oauth_client_id]}",
        clientSecret: "${[oauth_client_secret]}",
      }),
    ]);
  });

  test("Uses the server environment origin for OAuth endpoints with a path-only API base", async () => {
    const imported = await convertOpenApi(
      JSON.stringify({
        openapi: "3.0.4",
        info: { title: "Path-only OAuth Test", version: "1.0.0" },
        servers: [{ url: "/api/v1" }],
        paths: {
          "/users": { get: { security: [{ oauth: [] }], responses: {} } },
        },
        components: {
          securitySchemes: {
            oauth: {
              type: "oauth2",
              flows: {
                authorizationCode: {
                  authorizationUrl: "oauth/authorize",
                  tokenUrl: "/oauth/token",
                  scopes: {},
                },
              },
            },
          },
        },
      }),
    );

    expect(imported?.resources.httpRequests[0]?.authentication).toEqual(
      expect.objectContaining({
        authorizationUrl: "${[baseUrlOrigin]}/api/v1/oauth/authorize",
        accessTokenUrl: "${[baseUrlOrigin]}/oauth/token",
      }),
    );
    expect(imported?.resources.environments).toEqual([
      expect.objectContaining({ name: "Global Variables", variables: [] }),
      expect.objectContaining({
        name: "Server 1",
        variables: [
          { name: "baseUrl", value: "/api/v1" },
          { name: "oauth_client_id", value: "" },
          { name: "oauth_client_secret", value: "" },
          { name: "baseUrlOrigin", value: "" },
        ],
      }),
    ]);
  });

  test("Imports Swagger 2 OAuth2 flows and produces", async () => {
    const imported = await convertOpenApi(
      JSON.stringify({
        swagger: "2.0",
        info: { title: "Swagger OAuth Test", version: "1.0.0" },
        host: "example.com",
        produces: ["application/json"],
        paths: { "/a": { get: { security: [{ oauth: ["admin"] }], responses: {} } } },
        securityDefinitions: {
          oauth: {
            type: "oauth2",
            flow: "accessCode",
            authorizationUrl: "https://example.com/authorize",
            tokenUrl: "https://example.com/token",
            scopes: { admin: "Admin access" },
          },
        },
      }),
    );

    expect(imported?.resources.httpRequests[0]).toEqual(
      expect.objectContaining({
        authenticationType: "oauth2",
        authentication: {
          grantType: "authorization_code",
          clientId: "${[oauth_client_id]}",
          clientSecret: "${[oauth_client_secret]}",
          headerPrefix: "Bearer",
          scope: "admin",
          authorizationUrl: "https://example.com/authorize",
          accessTokenUrl: "https://example.com/token",
        },
        headers: [{ enabled: true, name: "Accept", value: "application/json" }],
      }),
    );
  });

  test("Names operations that only carry a description", async () => {
    const imported = await convertOpenApi(
      JSON.stringify({
        openapi: "3.0.0",
        info: { title: "Naming Test", version: "1.0.0" },
        paths: {
          "/a": { get: { description: "Fetch the current comic.\nMore detail here.\n" } },
          "/b": { get: { description: `${"x".repeat(101)}` } },
          "/c": { get: { summary: "Explicit summary", description: "Ignored" } },
        },
      }),
    );

    expect(imported?.resources.httpRequests.map((r) => r.name)).toEqual([
      "Fetch the current comic.",
      // Too long to read as a name, so the route is clearer
      "GET /b",
      "Explicit summary",
    ]);
  });

  test("Disambiguates requests that would share a name", async () => {
    const imported = await convertOpenApi(
      JSON.stringify({
        openapi: "3.0.0",
        info: { title: "Duplicate Test", version: "1.0.0" },
        paths: {
          "/anything": {
            get: { summary: "Returns anything" },
            post: { summary: "Returns anything" },
          },
          "/unique": { get: { summary: "Stands alone" } },
        },
      }),
    );

    expect(imported?.resources.httpRequests.map((r) => r.name)).toEqual([
      "Returns anything (GET /anything)",
      "Returns anything (POST /anything)",
      "Stands alone",
    ]);
  });

  test("Flags deprecated operations", async () => {
    const imported = await convertOpenApi(
      JSON.stringify({
        openapi: "3.0.0",
        info: { title: "Deprecated Test", version: "1.0.0" },
        paths: {
          "/old": { get: { summary: "Old", deprecated: true, description: "Use /new instead." } },
          "/new": { get: { summary: "New" } },
        },
      }),
    );

    expect(imported?.resources.httpRequests[0]?.description).toBe(
      "Deprecated.\n\nUse /new instead.",
    );
    expect(imported?.resources.httpRequests[1]?.description).toBe("New");
  });

  test("Derives an Accept header from OpenAPI 3 responses", async () => {
    const imported = await convertOpenApi(
      JSON.stringify({
        openapi: "3.0.0",
        info: { title: "Accept Test", version: "1.0.0" },
        paths: {
          "/prefers-json": {
            get: {
              responses: {
                "200": {
                  description: "ok",
                  content: { "application/xml": {}, "application/json": {} },
                },
              },
            },
          },
          // Only failures describe content, so there is nothing to accept
          "/errors-only": {
            get: {
              responses: { "500": { description: "nope", content: { "application/json": {} } } },
            },
          },
        },
      }),
    );

    expect(imported?.resources.httpRequests[0]?.headers).toEqual([
      { enabled: true, name: "Accept", value: "application/json" },
    ]);
    expect(imported?.resources.httpRequests[1]?.headers).toEqual([]);
  });

  test("Lets an operation override a path-level parameter", async () => {
    const imported = await convertOpenApi(
      JSON.stringify({
        openapi: "3.0.0",
        info: { title: "Override Test", version: "1.0.0" },
        paths: {
          "/a": {
            parameters: [
              { name: "page", in: "query", required: false, schema: { example: "path-level" } },
              { name: "keep", in: "query", required: true, schema: { example: "untouched" } },
            ],
            get: {
              parameters: [
                // Same name and location as above, so it replaces rather than adds
                { name: "page", in: "query", required: true, schema: { example: "operation" } },
                // Same name but a different location, so it is its own parameter
                { name: "page", in: "header", schema: { example: "header-level" } },
              ],
              responses: {},
            },
          },
        },
      }),
    );

    expect(imported?.resources.httpRequests[0]?.urlParameters).toEqual([
      { enabled: true, name: "page", value: "operation" },
      { enabled: true, name: "keep", value: "untouched" },
    ]);
    expect(imported?.resources.httpRequests[0]?.headers).toEqual([
      { enabled: false, name: "page", value: "header-level" },
    ]);
  });

  test("Prefers operation-level consumes for Swagger bodies", async () => {
    const imported = await convertOpenApi(
      JSON.stringify({
        swagger: "2.0",
        info: { title: "Consumes Test", version: "1.0.0" },
        host: "example.com",
        consumes: ["application/json"],
        paths: {
          "/a": {
            post: {
              consumes: ["application/xml"],
              parameters: [{ name: "body", in: "body", schema: { type: "object" } }],
              responses: {},
            },
          },
        },
      }),
    );

    expect(imported?.resources.httpRequests[0]).toEqual(
      expect.objectContaining({
        // Yaak's XML body type; the header keeps the spec's media type
        bodyType: "text/xml",
        headers: expect.arrayContaining([
          { enabled: true, name: "Content-Type", value: "application/xml" },
        ]),
      }),
    );
  });

  test("Imports Swagger 2 basic auth and cookie API keys", async () => {
    const imported = await convertOpenApi(
      JSON.stringify({
        swagger: "2.0",
        info: { title: "Auth Test", version: "1.0.0" },
        host: "example.com",
        paths: {
          "/a": { get: { security: [{ basicAuth: [] }], responses: {} } },
          "/b": { get: { security: [{ cookieKey: [] }], responses: {} } },
        },
        securityDefinitions: {
          basicAuth: { type: "basic" },
          cookieKey: { type: "apiKey", in: "cookie", name: "session" },
        },
      }),
    );

    expect(imported?.resources.httpRequests[0]).toEqual(
      expect.objectContaining({
        authenticationType: "basic",
        authentication: {
          username: "${[auth_basic_auth_username]}",
          password: "${[auth_basic_auth_password]}",
        },
      }),
    );
    // The auth plugin has no cookie location, so it becomes the Cookie header
    expect(imported?.resources.httpRequests[1]).toEqual(
      expect.objectContaining({
        authenticationType: "apikey",
        authentication: {
          location: "header",
          key: "Cookie",
          value: "session=${[auth_cookie_key_key]}",
        },
      }),
    );
    expect(imported?.resources.environments).toEqual([
      expect.objectContaining({
        name: "Global Variables",
        variables: [],
      }),
      expect.objectContaining({
        name: "Server 1",
        variables: [
          { name: "baseUrl", value: "https://example.com" },
          { name: "auth_basic_auth_username", value: "" },
          { name: "auth_basic_auth_password", value: "" },
          { name: "auth_cookie_key_key", value: "" },
        ],
      }),
    ]);
  });

  test("Preserves anonymous security alternatives and explicit auth overrides", async () => {
    const imported = await convertOpenApi(
      JSON.stringify({
        openapi: "3.1.0",
        info: { title: "Optional Auth", version: "1.0.0" },
        security: [{ bearerAuth: [] }],
        paths: {
          "/optional-auth-first": {
            get: { security: [{ bearerAuth: [] }, {}], responses: {} },
          },
          "/optional-anonymous-first": {
            get: { security: [{}, { bearerAuth: [] }], responses: {} },
          },
          "/public": { get: { security: [], responses: {} } },
        },
        components: {
          securitySchemes: {
            bearerAuth: { type: "http", scheme: "bearer" },
          },
        },
      }),
    );

    expect(imported?.resources.httpRequests).toEqual([
      expect.objectContaining({ authenticationType: "none", authentication: {} }),
      expect.objectContaining({ authenticationType: "none", authentication: {} }),
      expect.objectContaining({ authenticationType: "none", authentication: {} }),
    ]);
  });

  test("Imports AND security requirements without dropping API keys", async () => {
    const imported = await convertOpenApi(
      JSON.stringify({
        openapi: "3.1.0",
        info: { title: "Combined Auth", version: "1.0.0" },
        paths: {
          "/combined": {
            get: {
              security: [{ bearerAuth: [], tenantKey: [], queryKey: [] }],
              parameters: [
                {
                  in: "header",
                  name: "X-Tenant-Key",
                  example: "operation-value-must-not-replace-auth",
                },
              ],
              responses: {},
            },
          },
        },
        components: {
          securitySchemes: {
            bearerAuth: { type: "http", scheme: "bearer" },
            tenantKey: { type: "apiKey", in: "header", name: "X-Tenant-Key" },
            queryKey: { type: "apiKey", in: "query", name: "api_key" },
          },
        },
      }),
    );

    expect(imported?.resources.httpRequests).toEqual([
      expect.objectContaining({
        authenticationType: "bearer",
        authentication: { token: "${[auth_bearer_auth_token]}", prefix: "Bearer" },
        headers: [{ enabled: true, name: "X-Tenant-Key", value: "${[auth_tenant_key_key]}" }],
        urlParameters: [{ enabled: true, name: "api_key", value: "${[auth_query_key_key]}" }],
      }),
    ]);
  });

  test("Keeps distinct credentials for security scheme names that normalize alike", async () => {
    const imported = await convertOpenApi(
      JSON.stringify({
        openapi: "3.1.0",
        info: { title: "Auth Variable Names", version: "1.0.0" },
        paths: {
          "/hyphen": { get: { security: [{ "api-key": [] }], responses: {} } },
          "/underscore": { get: { security: [{ api_key: [] }], responses: {} } },
          "/hyphen-again": { get: { security: [{ "api-key": [] }], responses: {} } },
        },
        components: {
          securitySchemes: {
            "api-key": { type: "apiKey", in: "header", name: "X-Hyphen-Key" },
            api_key: { type: "apiKey", in: "header", name: "X-Underscore-Key" },
          },
        },
      }),
    );

    expect(imported?.resources.environments[0]?.variables).toEqual([]);
    expect(imported?.resources.environments[1]).toEqual(
      expect.objectContaining({
        name: "Default",
        variables: [
          { name: "baseUrl", value: "" },
          { name: "auth_api_key_key", value: "" },
          { name: "auth_api_key_key_2", value: "" },
        ],
      }),
    );
    expect(imported?.resources.httpRequests).toEqual([
      expect.objectContaining({
        authentication: expect.objectContaining({ value: "${[auth_api_key_key]}" }),
      }),
      expect.objectContaining({
        authentication: expect.objectContaining({ value: "${[auth_api_key_key_2]}" }),
      }),
      expect.objectContaining({
        authentication: expect.objectContaining({ value: "${[auth_api_key_key]}" }),
      }),
    ]);
  });

  test("Imports OpenID Connect as bearer authentication", async () => {
    const imported = await convertOpenApi(
      JSON.stringify({
        openapi: "3.1.0",
        info: { title: "OpenID Connect", version: "1.0.0" },
        paths: { "/me": { get: { security: [{ oidc: [] }], responses: {} } } },
        components: {
          securitySchemes: {
            oidc: {
              type: "openIdConnect",
              openIdConnectUrl: "https://accounts.example.com/.well-known/openid-configuration",
            },
          },
        },
      }),
    );

    expect(imported?.resources.httpRequests).toEqual([
      expect.objectContaining({
        authenticationType: "bearer",
        authentication: { token: "${[auth_oidc_token]}", prefix: "Bearer" },
      }),
    ]);
  });

  test("Resolves references that point into arrays", async () => {
    const imported = await convertOpenApi(
      JSON.stringify({
        openapi: "3.0.0",
        info: { title: "Array Ref Test", version: "1.0.0" },
        paths: {
          "/a": {
            get: {
              parameters: [
                { name: "limit", in: "query", required: true, schema: { example: "42" } },
              ],
              responses: {},
            },
          },
          "/b": {
            get: { parameters: [{ $ref: "#/paths/~1a/get/parameters/0" }], responses: {} },
          },
        },
      }),
    );

    expect(imported?.resources.httpRequests[1]?.urlParameters).toEqual([
      { enabled: true, name: "limit", value: "42" },
    ]);
  });

  test("Resolves example references and 3.1 example arrays", async () => {
    const imported = await convertOpenApi(
      JSON.stringify({
        openapi: "3.1.0",
        info: { title: "Examples Test", version: "1.0.0" },
        paths: {
          "/a": {
            post: {
              parameters: [
                { name: "q", in: "query", schema: { type: "string", examples: ["hello"] } },
              ],
              requestBody: {
                content: {
                  "application/json": {
                    schema: { type: "object" },
                    examples: { main: { $ref: "#/components/examples/Main" } },
                  },
                },
              },
              responses: {},
            },
          },
        },
        components: { examples: { Main: { value: { x: "from-example" } } } },
      }),
    );

    expect(imported?.resources.httpRequests[0]?.body).toEqual({
      text: JSON.stringify({ x: "from-example" }, null, 2),
    });
    expect(imported?.resources.httpRequests[0]?.urlParameters).toEqual([
      { enabled: false, name: "q", value: "hello" },
    ]);
  });

  test("Keeps template-looking braces in descriptions and examples", async () => {
    const imported = await convertOpenApi(
      JSON.stringify({
        openapi: "3.0.0",
        info: { title: "Braces Test", version: "1.0.0" },
        paths: {
          "/a": {
            post: {
              description: "Use {{placeholders}} in the template",
              requestBody: {
                content: {
                  "application/json": { schema: { type: "string", example: "Hi {{name}}" } },
                },
              },
              responses: {},
            },
          },
        },
      }),
    );

    expect(imported?.resources.httpRequests[0]?.description).toContain("{{placeholders}}");
    expect(imported?.resources.httpRequests[0]?.body).toEqual({ text: "Hi {{name}}" });
  });

  test("Ignores header parameters the spec reserves for other mechanisms", async () => {
    const imported = await convertOpenApi(
      JSON.stringify({
        openapi: "3.0.0",
        info: { title: "Reserved Headers Test", version: "1.0.0" },
        paths: {
          "/a": {
            post: {
              parameters: [
                { name: "Content-Type", in: "header", schema: { example: "application/xml" } },
                { name: "Accept", in: "header", schema: { example: "text/html" } },
                { name: "Authorization", in: "header", schema: { example: "custom" } },
                { name: "X-Custom", in: "header", schema: { example: "kept" } },
              ],
              requestBody: { content: { "application/json": { schema: { type: "object" } } } },
              responses: {},
            },
          },
        },
      }),
    );

    expect(imported?.resources.httpRequests[0]?.headers).toEqual([
      { enabled: false, name: "X-Custom", value: "kept" },
      { enabled: true, name: "Content-Type", value: "application/json" },
    ]);
  });

  test("Imports cookie parameters as a Cookie header", async () => {
    const imported = await convertOpenApi(
      JSON.stringify({
        openapi: "3.0.0",
        info: { title: "Cookie Test", version: "1.0.0" },
        paths: {
          "/a": {
            get: {
              parameters: [
                { name: "session", in: "cookie", required: true, schema: { example: "abc" } },
                { name: "theme", in: "cookie", schema: { example: "dark" } },
              ],
              responses: {},
            },
          },
        },
      }),
    );

    expect(imported?.resources.httpRequests[0]?.headers).toEqual([
      { enabled: true, name: "Cookie", value: "session=abc; theme=dark" },
    ]);
  });

  test("Inlines path templates that Yaak placeholders cannot express", async () => {
    const imported = await convertOpenApi(
      JSON.stringify({
        openapi: "3.0.0",
        info: { title: "Mid-Segment Test", version: "1.0.0" },
        paths: {
          "/report.{format}": {
            get: {
              parameters: [
                { name: "format", in: "path", required: true, schema: { example: "csv" } },
              ],
              responses: {},
            },
          },
          "/tasks/{id}:cancel": {
            post: {
              parameters: [{ name: "id", in: "path", required: true, schema: { example: "7" } }],
              responses: {},
            },
          },
        },
      }),
    );

    expect(imported?.resources.httpRequests.map((r) => [r.url, r.urlParameters])).toEqual([
      ["${[baseUrl]}/report.csv", []],
      ["${[baseUrl]}/tasks/:id:cancel", [{ enabled: true, name: ":id", value: "7" }]],
    ]);
  });

  test("Enables path parameters even when required is omitted", async () => {
    const imported = await convertOpenApi(
      JSON.stringify({
        openapi: "3.0.0",
        info: { title: "Sloppy Path Test", version: "1.0.0" },
        paths: {
          "/users/{userId}": {
            get: {
              parameters: [{ name: "userId", in: "path", schema: { type: "string" } }],
              responses: {},
            },
          },
        },
      }),
    );

    // No example either, so the name stands in for an empty path segment
    expect(imported?.resources.httpRequests[0]?.urlParameters).toEqual([
      { enabled: true, name: ":userId", value: "userId" },
    ]);
  });

  test("Coerces examples to the declared schema type", async () => {
    const imported = await convertOpenApi(
      JSON.stringify({
        openapi: "3.0.0",
        info: { title: "Coercion Test", version: "1.0.0" },
        paths: {
          "/a": {
            post: {
              requestBody: {
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      properties: {
                        password: { type: "string", example: 12345 },
                        count: { type: "integer", example: "3" },
                        note: { example: 7 },
                      },
                    },
                  },
                },
              },
              responses: {},
            },
          },
        },
      }),
    );

    expect(imported?.resources.httpRequests[0]?.body).toEqual({
      text: JSON.stringify({ password: "12345", count: 3, note: 7 }, null, 2),
    });
  });

  test("Merges allOf branches with sibling properties", async () => {
    const imported = await convertOpenApi(
      JSON.stringify({
        openapi: "3.1.0",
        info: { title: "AllOf Test", version: "1.0.0" },
        paths: {
          "/a": {
            post: {
              requestBody: {
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      allOf: [
                        { type: "object", properties: { fromAllOf: { example: "a" } } },
                      ],
                      properties: { sibling: { example: "b" } },
                    },
                  },
                },
              },
              responses: {},
            },
          },
        },
      }),
    );

    expect(imported?.resources.httpRequests[0]?.body).toEqual({
      text: JSON.stringify({ fromAllOf: "a", sibling: "b" }, null, 2),
    });
  });

  test("Accepts unquoted YAML version numbers", async () => {
    const imported = await convertOpenApi(
      ["swagger: 2.0", "info:", "  title: Unquoted Test", '  version: "1"', "host: example.com", "paths:", "  /a:", "    get:", "      responses: {}"].join("\n"),
    );

    expect(imported?.resources.httpRequests[0]?.url).toBe("${[baseUrl]}/a");
  });

  test("Normalizes body types to Yaak's editors", async () => {
    const imported = await convertOpenApi(
      JSON.stringify({
        openapi: "3.0.0",
        info: { title: "Body Type Test", version: "1.0.0" },
        paths: {
          "/vnd-json": {
            post: {
              requestBody: {
                content: { "application/vnd.api+json": { schema: { type: "object" } } },
              },
              responses: {},
            },
          },
          "/plain": {
            post: {
              requestBody: { content: { "text/plain": { schema: { type: "string" } } } },
              responses: {},
            },
          },
        },
      }),
    );

    expect(
      imported?.resources.httpRequests.map((r) => [r.bodyType, r.headers?.[0]?.value]),
    ).toEqual([
      ["application/json", "application/vnd.api+json"],
      ["other", "text/plain"],
    ]);
  });

  test("Trims trailing slashes from server URLs", async () => {
    const imported = await convertOpenApi(
      JSON.stringify({
        openapi: "3.0.0",
        info: { title: "Trailing Slash Test", version: "1.0.0" },
        servers: [{ url: "https://api.example.com/v1/" }],
        paths: { "/pets": { get: { responses: {} } } },
      }),
    );

    expect(imported?.resources.environments[1]?.variables).toEqual([
      { name: "baseUrl", value: "https://api.example.com/v1" },
    ]);
  });

  test("Reports references that point outside the document", async () => {
    const imported = await convertOpenApi(
      JSON.stringify({
        openapi: "3.0.0",
        info: { title: "External Ref Test", version: "1.0.0" },
        paths: {
          "/a": {
            post: {
              requestBody: {
                content: {
                  "application/json": { schema: { $ref: "./shared.yaml#/components/schemas/Foo" } },
                },
              },
              responses: {},
            },
          },
          "/b": { get: { responses: {} } },
        },
      }),
    );

    expect(imported?.resources.httpRequests[0]?.description).toContain(
      "./shared.yaml#/components/schemas/Foo",
    );
    // The report is per-operation, so an unrelated request stays clean
    expect(imported?.resources.httpRequests[1]?.description).toBeUndefined();
  });

  for (const fixture of fixtures) {
    test(`Imports ${fixture}`, async () => {
      const contents = fs.readFileSync(path.join(p, fixture), "utf-8");
      const imported = await convertOpenApi(contents);
      expect(imported?.resources.workspaces).toEqual([
        expect.objectContaining({
          name: "Swagger Petstore - OpenAPI 3.0",
          description: expect.stringContaining("This is a sample Pet Store Server"),
        }),
      ]);
      expect(imported?.resources.httpRequests.length).toBe(19);
      expect(imported?.resources.folders.map((f) => f.name)).toEqual(["pet", "store", "user"]);
    });
  }

  for (const fixture of realWorldFixtures) {
    test(`Snapshots real-world fixture ${fixture}`, async () => {
      const contents = fs.readFileSync(path.join(realWorldFixturesPath, fixture), "utf-8");
      const imported = await convertOpenApi(contents);
      expect(imported).toMatchSnapshot();
    });
  }
});
