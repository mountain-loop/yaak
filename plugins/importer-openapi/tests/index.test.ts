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
