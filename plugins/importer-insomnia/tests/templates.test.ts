import { Buffer } from "node:buffer";
import { describe, expect, test } from "vite-plus/test";
import { convertTemplateSyntax } from "../src/templates";

const requestIds = new Set(["GENERATE_ID::req_login"]);
const convert = (text: string) => convertTemplateSyntax(text, requestIds);
const encoded = (text: string) => `b64'${Buffer.from(text).toString("base64url")}'`;

describe("Insomnia templates", () => {
  test.each(["{{ _.token }}", "{{ token }}", "{{ _['token'] }}", '{{ _ [ "token" ] }}'])(
    "converts %s",
    (input) => expect(convert(input)).toBe("${[ token ]}"),
  );

  test.each([
    "{{ _.token | default('fallback') }}",
    "{{ _['two words'] }}",
    "{{ _['a']['b'] }}",
    "{{ _.a + _.b }}",
    "{{ true }}",
    "{% uuid 'v7' %}",
    "{% faker 'name' %}",
    "{% dopplersecret 'project', 'config', 'secret' %}",
    "{% response 'body', 'req_missing', '$.token', 'always', 60 %}",
    "{% response 'body', 'req_login', '$.token', 'unknown', 60 %}",
    "{% response 'body', 'req_login', '$.token', 'always', -1 %}",
    "{% response 'body' garbage, 'req_login', '$.token', 'always', 60 %}",
    "{% response 'body', 'req_login', 'b64::!!::nonce', 'always', 60 %}",
    "{% response 'body', 'req_login', '$.token', 'always', 60, %}",
    "{% response 'body', 'req_login', '$.tokens[*]', 'always', 60 %}",
    "{% response 'body', 'req_login', '$..token', 'always', 60 %}",
    "{% response 'body', 'req_login', '/root/token', 'always', 60 %}",
    "{% response 'body', 'req_login', '', 'never', 0 %}",
    "{% response 'body', 'req_login', '$.token', 'when-expired', 0 %}",
  ])("preserves unsupported or malformed syntax: %s", (input) => {
    expect(convert(input)).toBe(input);
  });

  test.each(["v1", "v4"])("converts UUID %s", (version) => {
    expect(convert(`{% uuid '${version}' %}`)).toBe(`\${[ uuid.${version}() ]}`);
  });
  test("converts only the equivalent Faker UUID function", () => {
    expect(convert("{% faker 'randomUUID' %}")).toBe("${[ uuid.v4() ]}");
  });

  test.each([
    ["never", "never"],
    ["no-history", "smart"],
    ["always", "always"],
    ["when-expired", "ttl"],
  ])("preserves %s sending behavior", (source, target) => {
    expect(convert(`{% response 'body', 'req_login', '$.token', '${source}', 60 %}`)).toBe(
      `\${[ response.body.path(request=${encoded("GENERATE_ID::req_login")}, behavior='${target}', ttl='60', path=${encoded("$.token")}, result='first') ]}`,
    );
  });

  test("decodes Insomnia's UTF-8 base64 filters and emits URL-safe Yaak arguments", () => {
    const path = "$.clé[0].token";
    const base64 = Buffer.from(path).toString("base64");
    expect(
      convert(`{% response 'body', 'req_login', 'b64::${base64}::nonce', 'never', 0 %}`),
    ).toContain(`path=${encoded(path)}`);
    expect(convert(`{% response 'body', 'req_login', '${path}', 'never', 0 %}`)).toContain(
      `path=${encoded(path)}`,
    );
  });

  test("maps raw body and headers, including quotes/commas in literal arguments", () => {
    expect(convert("{% response 'raw', 'req_login', '', 'never', 0 %}")).toContain(
      "response.body.raw(",
    );
    expect(
      convert("{% response 'header', 'req_login', 'x-\\'quoted,header', 'never', 0 %}"),
    ).toContain(`header=${encoded("x-'quoted,header")}`);
  });

  test("converts nested resource fields without changing the input", () => {
    const input = {
      authentication: { token: "{{ _['token'] }}" },
      body: { form: [{ value: "{% uuid 'v4' %}" }] },
    };
    expect(convertTemplateSyntax(input)).toEqual({
      authentication: { token: "${[ token ]}" },
      body: { form: [{ value: "${[ uuid.v4() ]}" }] },
    });
    expect(input.authentication.token).toBe("{{ _['token'] }}");
  });
});
