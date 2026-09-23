import { readFileSync } from "node:fs";
import { describe, expect, test } from "vite-plus/test";
import YAML from "yaml";
import { convertBruno } from "../src";
import { auth } from "../src/auth";
import { body, urlAndParams } from "../src/body";
import { template, variables } from "../src/common";

function collection(items: unknown[] = [], extra: Record<string, unknown> = {}) {
  return { opencollection: "1.0.0", info: { name: "Test" }, bundled: true, items, ...extra };
}
const fixture = readFileSync(new URL("./fixtures/collection.yaml", import.meta.url), "utf8");

describe("Bruno OpenCollection importer", () => {
  test("imports a bundled export with folders, scopes, disabled rows, and all four request types", () => {
    const imported = convertBruno(fixture)!;
    const {
      workspaces: [workspace],
      folders: [folder],
      environments,
      httpRequests,
      grpcRequests: [grpc],
      websocketRequests: [ws],
    } = imported.resources;
    expect(workspace).toMatchObject({
      name: "Example API",
      authenticationType: "bearer",
      authentication: { token: "${[ token ]}" },
      description: "Synthetic migration fixture.",
    });
    expect(folder).toMatchObject({ name: "Users", sortPriority: 2, authenticationType: null });
    const [base, dev, shared, folderEnv] = environments;
    expect(base).toMatchObject({
      parentModel: "workspace",
      parentId: null,
      variables: [
        { name: "host", value: "https://example.com" },
        { name: "client", value: "yaak" },
      ],
    });
    expect(dev).toMatchObject({
      parentModel: "environment",
      parentId: null,
      variables: [
        { name: "count", value: "42" },
        { name: "host" },
        { name: "token", value: "" },
        { name: "disabled", enabled: false },
      ],
    });
    expect(shared).toMatchObject({ color: "#123456", variables: [{ name: "count", value: "42" }] });
    expect(folderEnv).toMatchObject({ parentModel: "folder", parentId: folder!.id });
    const [get, graphql, publicRequest, upload] = httpRequests;
    expect(get).toMatchObject({
      folderId: folder!.id,
      authenticationType: null,
      sortPriority: 3,
      url: "${[ host ]}/users/:id?keep=1#details",
      urlParameters: [
        { name: ":id", value: "${[ userId ]}", enabled: true },
        { name: "expand", value: "profile", enabled: true },
        { name: "inactive", value: "true", enabled: false },
      ],
      headers: [{ name: "X-Disabled", value: "ignored", enabled: false }],
      settingFollowRedirects: { enabled: true, value: false },
      settingRequestTimeout: { enabled: true, value: 2000 },
    });
    expect(graphql).toMatchObject({
      bodyType: "graphql",
      method: "POST",
      authenticationType: "basic",
      authentication: { username: "${[ client ]}" },
      body: {
        query: "query Get($id: ID!) { node(id: $id) { id } }",
        variables: '{"id":"${[ userId ]}"}',
      },
      headers: [{ name: "Content-Type", value: "application/json", enabled: true }],
    });
    expect(publicRequest).toMatchObject({ authenticationType: "none", folderId: null });
    expect(upload?.body?.form).toEqual([
      { name: "label", value: "${[ client ]}", enabled: true },
      { name: "files", file: "./first.txt", contentType: "text/plain", enabled: true },
      { name: "files", file: "./second.txt", contentType: "text/plain", enabled: true },
    ]);
    expect(grpc).toMatchObject({
      service: "example.Greeter",
      method: "SayHello",
      message: '{"name":"${[ client ]}"}',
    });
    expect(ws).toMatchObject({
      message: '{"subscribe":"${[ client ]}"}',
      authenticationType: null,
    });
    const all = Object.values(imported.resources).flat();
    expect(new Set(all.map((r) => r.id)).size).toBe(all.length);
    expect(
      all.filter((r) => r.model !== "workspace").every((r) => r.workspaceId === workspace!.id),
    ).toBe(true);
    expect(imported.sourceKeys).toBeUndefined();
    expect(convertBruno(fixture)).toEqual(imported);
  });

  test("accepts JSON serialization and inline collections without a bundled flag", () => {
    expect(convertBruno(JSON.stringify(YAML.parse(fixture)))).toEqual(convertBruno(fixture));
    expect(
      convertBruno(JSON.stringify({ opencollection: "1.0.0", items: [] }))?.resources.workspaces,
    ).toHaveLength(1);
    expect(convertBruno(JSON.stringify(collection()))?.resources.httpRequests).toHaveLength(0);
  });

  test.each([
    "",
    "not: [valid",
    "null",
    "[]",
    "openapi: 3.1.0",
    '{"info":{"name":"Postman"},"item":[]}',
    "meta { name: Test }",
    "opencollection: 1.0.0\nbundled: true\nitems: &items [*items]",
  ])("ignores unrelated, malformed, or cyclic input: %s", (input) => {
    expect(convertBruno(input)).toBeNull();
  });

  test("rejects directory config and unknown format versions with actionable errors", () => {
    expect(() => convertBruno("opencollection: 1.0.0\ninfo:\n  name: Directory")).toThrow(
      "Share menu",
    );
    expect(() => convertBruno(JSON.stringify(collection([], { bundled: false })))).toThrow(
      "single YAML file",
    );
    expect(() => convertBruno(JSON.stringify(collection([], { opencollection: "2.0.0" })))).toThrow(
      "Unsupported Bruno collection format version",
    );
  });

  test("rejects missing and cyclic environment parents", () => {
    for (const environments of [
      [{ name: "A", extends: "missing" }],
      [{ name: "A", extends: "A" }],
      [
        { name: "A", extends: "B" },
        { name: "B", extends: "A" },
      ],
    ]) {
      expect(() =>
        convertBruno(JSON.stringify(collection([], { config: { environments } }))),
      ).toThrow(/environment/);
    }
  });

  test("retains scripts, request variables, unsupported authentication, and unknown items for manual migration", () => {
    const result = convertBruno(
      JSON.stringify(
        collection([
          {
            info: { name: "Scripted", type: "http" },
            http: { url: "{{host}}", auth: { type: "wsse", username: "test" } },
            runtime: {
              scripts: [{ code: "bru.setVar('token', 'example');\n```" }],
              variables: [{ name: "host", value: "https://example.com" }],
            },
          },
          { info: { name: "App", type: "app" }, code: "example" },
        ]),
      ),
    )!;
    expect(result.resources.httpRequests[0]).toMatchObject({ authenticationType: "none" });
    const desc = result.resources.httpRequests[0]!.description;
    expect(desc).toContain("not executed");
    expect(desc).toContain("bru.setVar");
    expect(desc).toContain("variables:");
    expect(desc).toContain("wsse");
    expect(desc).toContain("````yaml");
    expect(result.resources.folders[0]?.description).toContain("unsupportedItem:");
  });

  test("does not override a collection Content-Type with a generated body header", () => {
    const result = convertBruno(
      JSON.stringify(
        collection(
          [{ info: { name: "JSON", type: "http" }, http: { body: { type: "json", data: "{}" } } }],
          {
            request: { headers: [{ name: "content-type", value: "application/vnd.example+json" }] },
          },
        ),
      ),
    )!;
    expect(result.resources.httpRequests[0]?.headers).toEqual([]);
  });
});

describe("request conversion", () => {
  test.each([
    ["json", "application/json", "application/json"],
    ["xml", "application/xml", "application/xml"],
    ["text", "other", "text/plain"],
    ["sparql", "other", "application/sparql-query"],
  ])("imports %s bodies with a default content type", (type, bodyType, contentType) => {
    expect(body({ type, data: "{{value}}" }, false, [])).toEqual({
      bodyType,
      body: { text: "${[ value ]}" },
      headers: [{ name: "Content-Type", value: contentType, enabled: true }],
    });
  });
  test("preserves explicit and disabled Content-Type headers", () => {
    expect(
      body({ type: "json", data: "{}" }, false, [
        { name: "CONTENT-type", value: "custom", disabled: true },
      ]).headers,
    ).toEqual([{ name: "CONTENT-type", value: "custom", enabled: false }]);
  });
  test("imports form fields and the selected file or body variant", () => {
    expect(
      body(
        { type: "form-urlencoded", data: [{ name: "field", value: "{{value}}", disabled: true }] },
        false,
        [],
      ).body,
    ).toEqual({ form: [{ name: "field", value: "${[ value ]}", enabled: false }] });
    expect(
      body(
        {
          type: "file",
          data: [
            { filePath: "wrong", selected: false },
            { filePath: "./correct.bin", selected: true, contentType: "application/octet-stream" },
          ],
        },
        false,
        [],
      ),
    ).toMatchObject({ bodyType: "binary", body: { filePath: "./correct.bin" } });
    expect(
      body(
        [
          { title: "A", body: { type: "json", data: "a" } },
          { title: "B", selected: true, body: { type: "json", data: "b" } },
        ],
        false,
        [],
      ).body,
    ).toEqual({ text: "b" });
    expect(
      body({ type: "file", data: [{ filePath: "disabled", selected: false }] }, false, []).bodyType,
    ).toBeNull();
  });
  test("imports raw GraphQL variables without parsing expressions and preserves operationName", () => {
    expect(
      body(
        { query: "query Get { me }", variables: '{"id": {{id}}}', operationName: "Get" },
        true,
        [],
      ).body,
    ).toEqual({ query: "query Get { me }", variables: '{"id": ${[ id ]}}', operationName: "Get" });
    expect(body({ query: "{ me }", variables: { id: "{{id}}" } }, true, []).body.variables).toBe(
      '{\n  "id": "${[ id ]}"\n}',
    );
  });
  test("avoids duplicate encoded query keys without losing unrelated query entries or fragments", () => {
    expect(
      urlAndParams("{{host}}/a?some%20key=old&some+key=old&keep=%2F#part", [
        { type: "query", name: "some key", value: "new" },
      ]),
    ).toMatchObject({
      url: "${[ host ]}/a?keep=%2F#part",
      urlParameters: [{ name: "some key", value: "new" }],
    });
    expect(urlAndParams("{{host}}/a?x=1", []).url).toBe("${[ host ]}/a?x=1");
  });
  test("converts plain variables and preserves unsupported expressions", () => {
    expect(
      template(
        "{{ host }} {{user.id}} {{process.env.TOKEN}} {{$randomUUID}} {{a + b}} {{true}} {{null}}",
      ),
    ).toBe(
      "${[ host ]} ${[ user.id ]} {{process.env.TOKEN}} {{$randomUUID}} {{a + b}} {{true}} {{null}}",
    );
    expect(
      variables([
        { name: "secret", secret: true, value: "must not import" },
        {
          name: "variant",
          value: [{ value: "a" }, { selected: true, value: { type: "object", data: '{"x":1}' } }],
        },
      ]),
    ).toEqual([
      { name: "secret", value: "", enabled: true },
      { name: "variant", value: '{"x":1}', enabled: true },
    ]);
  });
});

describe("authentication", () => {
  test("distinguishes request no-auth from explicit and folder inheritance", () => {
    expect(auth(undefined).authenticationType).toBe("none");
    expect(auth("inherit").authenticationType).toBeNull();
    expect(auth(undefined, true).authenticationType).toBeNull();
  });
  test.each([
    ["basic", "basic"],
    ["digest", "digest"],
    ["ntlm", "windows"],
    ["bearer", "bearer"],
    ["awsv4", "awsv4"],
  ])("imports %s auth", (type, expected) => {
    expect(auth({ type, username: "{{user}}", token: "{{token}}" }).authenticationType).toBe(
      expected,
    );
  });
  test("maps API key placement and OAuth client credentials/PKCE", () => {
    expect(auth({ type: "apikey", key: "key", value: "{{token}}", placement: "query" })).toEqual({
      authenticationType: "apikey",
      authentication: { key: "key", value: "${[ token ]}", location: "query" },
    });
    expect(
      auth({
        type: "oauth2",
        flow: "authorization_code",
        credentials: { clientId: "{{client}}", placement: "basic_auth_header" },
        callbackUrl: "http://localhost/callback",
        pkce: { method: "S256" },
        tokenConfig: { placement: { header: "Token" } },
      }).authentication,
    ).toMatchObject({
      grantType: "authorization_code",
      clientId: "${[ client ]}",
      credentials: "basic",
      redirectUri: "http://localhost/callback",
      usePkce: true,
      pkceChallengeMethod: "S256",
      headerPrefix: "Token",
    });
    expect(
      auth({
        type: "oauth2",
        flow: "resource_owner_password_credentials",
        resourceOwner: { username: "a", password: "b" },
      }).authentication,
    ).toMatchObject({ grantType: "password", username: "a", password: "b" });
    expect(auth({ type: "oauth2", flow: "client_credentials" }).authentication).toMatchObject({
      grantType: "client_credentials",
      credentials: "body",
      usePkce: false,
    });
  });
  test.each([
    { type: "awsv4", profileName: "local" },
    { type: "oauth2", flow: "client_credentials", tokenConfig: { placement: { query: "token" } } },
    { type: "oauth2", flow: "unknown" },
    { type: "wsse" },
  ])("does not silently inherit auth for unsupported configurations", (value) => {
    expect(auth(value).authenticationType).toBe("none");
  });
});

describe("scope and unsupported-field regressions", () => {
  test("flattens multi-level environments without disabled overrides hiding inherited values", () => {
    const environments = [
      {
        name: "Child",
        extends: "Middle",
        variables: [
          { name: "a", value: "disabled", disabled: true },
          { name: "b", value: "child" },
        ],
      },
      { name: "Middle", extends: "Root", variables: [{ name: "a", value: "middle" }] },
      {
        name: "Root",
        variables: [
          { name: "a", value: "root" },
          { name: "b", value: "root" },
          { name: "off", value: "ignored", disabled: true },
        ],
      },
    ];
    const result = convertBruno(JSON.stringify(collection([], { config: { environments } })))!;
    const child = result.resources.environments[1]!;
    expect(child.parentId).toBeNull();
    expect(child.variables).toEqual([
      { name: "a", value: "middle", enabled: true },
      { name: "a", value: "disabled", enabled: false },
      { name: "b", value: "child", enabled: true },
    ]);
  });

  test("distinguishes an empty folder from folder request defaults with no auth", () => {
    const result = convertBruno(
      JSON.stringify(
        collection([
          { info: { type: "folder", name: "Empty" } },
          { info: { type: "folder", name: "No auth" }, request: { headers: [] } },
          { info: { type: "folder", name: "Inherited" }, request: { auth: "inherit" } },
        ]),
      ),
    )!;
    expect(result.resources.folders.map((f) => f.authenticationType)).toEqual([null, "none", null]);
  });

  test("retains external environment settings and unknown bodies, and does not turn binary WS data into text", () => {
    const result = convertBruno(
      JSON.stringify(
        collection(
          [
            {
              info: { type: "http", name: "Unknown body" },
              http: { body: { type: "future", data: "original" } },
            },
            {
              info: { type: "websocket", name: "Binary" },
              websocket: { message: { type: "binary", data: "AA==" } },
            },
          ],
          {
            config: {
              environments: [
                {
                  name: "Vault",
                  externalSecrets: { type: "aws-secrets-manager" },
                  dotEnvFilePath: "./.env",
                },
              ],
            },
          },
        ),
      ),
    )!;
    expect(result.resources.workspaces[0]?.description).toContain("aws-secrets-manager");
    expect(result.resources.workspaces[0]?.description).toContain("./.env");
    expect(result.resources.httpRequests[0]?.description).toContain("original");
    expect(result.resources.websocketRequests[0]?.message).toBe("");
    expect(result.resources.websocketRequests[0]?.description).toContain("AA==");
  });

  test("maps OAuth 1.0 credentials and keeps unsupported private-key files inactive", () => {
    expect(
      auth({
        type: "oauth1",
        consumerKey: "{{key}}",
        accessToken: "token",
        accessTokenSecret: "secret",
        privateKey: { type: "text", value: "pem" },
      }),
    ).toMatchObject({
      authenticationType: "oauth1",
      authentication: {
        consumerKey: "${[ key ]}",
        tokenKey: "token",
        tokenSecret: "secret",
        privateKey: "pem",
        signatureMethod: "HMAC-SHA1",
      },
    });
    expect(
      auth({ type: "oauth1", privateKey: { type: "file", value: "./key.pem" } }).authenticationType,
    ).toBe("none");
    expect(auth({ type: "oauth1", placement: "query" }).authenticationType).toBe("none");
  });
});
