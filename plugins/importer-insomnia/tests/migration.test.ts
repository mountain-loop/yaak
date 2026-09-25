import { Buffer } from "node:buffer";
import { describe, expect, test } from "vite-plus/test";
import YAML from "yaml";
import { convertInsomnia } from "../src";

describe.each([4, 5])("Insomnia v%i migration", (version) => {
  test("imports GraphQL, credentials and forward response references together", () => {
    const requests = [
      {
        _id: "req_query",
        meta: { id: "req_query" },
        _type: "request",
        parentId: "wrk_test",
        name: "Query",
        method: "POST",
        url: "{{ _['host'] }}/graphql",
        authentication: {
          type: "bearer",
          token: "{% response 'body', 'req_login', 'b64::JC50b2tlbg==::abc', 'when-expired', 60 %}",
        },
        headers: [{ name: "X-Request-ID", value: "{% uuid 'v4' %}" }],
        parameters: [{ name: "id", value: '{{ _["id"] }}' }],
        body: {
          mimeType: "application/graphql",
          text: JSON.stringify({
            query: "query Get($id: ID!) { node(id: $id) { id } }",
            variables: '{"id":"{{ _.id }}"}',
            operationName: "Get",
          }),
        },
      },
      {
        _id: "req_login",
        meta: { id: "req_login" },
        _type: "request",
        parentId: "wrk_test",
        name: "Login",
        method: "POST",
        url: "{{ _.host }}/login",
        // Missing authentication is normal in minimal exports.
      },
    ];
    const source =
      version === 5
        ? YAML.stringify({
            type: "collection.insomnia.rest/5.0",
            name: "Migration",
            meta: { id: "wrk_test" },
            environments: {
              meta: { id: "env_base" },
              data: { host: "https://example.com", id: "123" },
            },
            collection: requests,
          })
        : JSON.stringify({
            _type: "export",
            __export_format: 4,
            resources: [
              { _type: "workspace", _id: "wrk_test", name: "Migration" },
              {
                _type: "environment",
                _id: "env_base",
                parentId: "wrk_test",
                data: { host: "https://example.com", id: "123" },
              },
              ...requests,
            ],
          });
    const imported = convertInsomnia(source)!;
    const [query, login] = imported.resources.httpRequests;
    expect(query?.body).toEqual({
      query: "query Get($id: ID!) { node(id: $id) { id } }",
      variables: '{"id":"${[ id ]}"}',
      operationName: "Get",
    });
    expect(query?.url).toBe("${[ host ]}/graphql");
    expect(query?.urlParameters?.[0]?.value).toBe("${[ id ]}");
    expect(query?.headers).toContainEqual({
      name: "X-Request-ID",
      value: "${[ uuid.v4() ]}",
      enabled: true,
    });
    expect(query?.headers).toContainEqual({
      name: "Content-Type",
      value: "application/json",
      enabled: true,
    });
    const ref = `b64'${Buffer.from(login!.id).toString("base64url")}'`;
    expect(query?.authentication?.token).toBe(
      `\${[ response.body.path(request=${ref}, behavior='ttl', ttl='60', path=b64'JC50b2tlbg', result='first') ]}`,
    );
    expect(imported.sourceKeys[login!.id]).toBe("req_login");
    expect(imported.sourceKeys[query!.id]).toBe("req_query");
  });
});
