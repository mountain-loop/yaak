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
      expect.objectContaining({ method: "QUERY", name: "Query resources", url: "/resources" }),
      expect.objectContaining({ method: "COPY", name: "Copy resources", url: "/resources" }),
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
        variables: [{ name: "baseUrl", value: "https://api.example.com/v1" }],
      }),
    ]);
    expect(imported?.resources.httpRequests).toEqual([
      expect.objectContaining({
        name: "Create member",
        method: "POST",
        url: "${[baseUrl]}/accounts/:accountId/members",
        authenticationType: "bearer",
        authentication: { token: "", prefix: "Bearer" },
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
      "https://path.example.com/path-level",
      "https://operation.example.com/operation-level",
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
          clientId: "",
          clientSecret: "",
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
          clientId: "",
          headerPrefix: "Bearer",
          authorizationUrl: "https://example.com/authorize",
        },
      }),
    );
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
          clientId: "",
          clientSecret: "",
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
        bodyType: "application/xml",
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
        authentication: { username: "", password: "" },
      }),
    );
    // The auth plugin has no cookie location, so it becomes the Cookie header
    expect(imported?.resources.httpRequests[1]).toEqual(
      expect.objectContaining({
        authenticationType: "apikey",
        authentication: { location: "header", key: "Cookie", value: "session=" },
      }),
    );
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
