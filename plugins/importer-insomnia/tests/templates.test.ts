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
    "{% response 'url', 'req_login', '', 'never', 0 %}",
    "{% os 'arch' %}",
    "{% file '/tmp/token.txt' %}",
    "{% jsonpath '{}', '$.a' %}",
    "{% request 'url' %}",
    "{% now 'quarter' %}",
    "{% uuid 'v4', 'extra' %}",
    "{% base64 'encode' %}",
    "{% cookie 'https://example.com' %}",
    "{% prompt %}",
    "{% timestamp 'ms' %}",
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

  test("converts a bare UUID tag to v4, the version Insomnia lists first", () => {
    expect(convert("{% uuid %}")).toBe("${[ uuid.v4() ]}");
  });

  test.each([
    ["{% now %}", "timestamp.iso8601()"],
    ["{% now 'iso-8601' %}", "timestamp.iso8601()"],
    ["{% now 'ISO-8601' %}", "timestamp.iso8601()"],
    ["{% now 'unix' %}", "timestamp.unix()"],
    ["{% now 'seconds' %}", "timestamp.unix()"],
    ["{% now 's' %}", "timestamp.unix()"],
    ["{% now 'millis' %}", "timestamp.unixMillis()"],
    ["{% now 'ms' %}", "timestamp.unixMillis()"],
    ["{% timestamp %}", "timestamp.unixMillis()"],
  ])("converts %s", (input, output) => {
    expect(convert(input)).toBe(`\${[ ${output} ]}`);
  });

  test("passes custom date formats through without translating tokens", () => {
    const format = "YYYY-MM-DD HH:mm:ss";
    expect(convert(`{% now 'custom', '${format}' %}`)).toBe(
      `\${[ timestamp.format(format=${encoded(format)}) ]}`,
    );
    expect(convert("{% now 'custom' %}")).toBe(`\${[ timestamp.format(format=${encoded("")}) ]}`);
  });

  test.each([
    ["{% base64 'encode', 'normal', 'hello' %}", "base64.encode(encoding='base64', value="],
    ["{% base64 'encode', 'url', 'hello' %}", "base64.encode(encoding='base64url', value="],
    // Yaak has no hex mode, so it imports as the plain alphabet.
    ["{% base64 'encode', 'hex', 'hello' %}", "base64.encode(encoding='base64', value="],
    ["{% base64 'encode', 'hello' %}", "base64.encode(encoding='base64', value="],
    ["{% base64 'decode', 'normal', 'hello' %}", "base64.decode(value="],
    ["{% base64 'decode', 'hello' %}", "base64.decode(value="],
  ])("converts %s", (input, prefix) => {
    expect(convert(input)).toBe(`\${[ ${prefix}${encoded("hello")}) ]}`);
  });

  test("defaults an omitted base64 value to the empty string", () => {
    expect(convert("{% base64 'encode', 'normal' %}")).toBe(
      `\${[ base64.encode(encoding='base64', value=${encoded("")}) ]}`,
    );
  });

  test("converts variables nested inside tag arguments", () => {
    expect(convert("{% base64 'encode', 'normal', '{{ _.secret }}' %}")).toBe(
      `\${[ base64.encode(encoding='base64', value=${encoded("${[ secret ]}")}) ]}`,
    );
  });

  test.each(["md5", "sha1", "sha256", "sha512"])("converts the %s hash", (algorithm) => {
    expect(convert(`{% hash '${algorithm}', 'hex', 'text' %}`)).toBe(
      `\${[ hash.${algorithm}(input=${encoded("text")}, encoding='hex') ]}`,
    );
  });

  test("keeps the base64 digest encoding", () => {
    expect(convert("{% hash 'sha256', 'base64', 'text' %}")).toBe(
      `\${[ hash.sha256(input=${encoded("text")}, encoding='base64') ]}`,
    );
  });

  test("defaults omitted hash arguments to MD5 and hex, like Insomnia's dropdowns", () => {
    expect(convert("{% hash %}")).toBe(`\${[ hash.md5(input=${encoded("")}, encoding='hex') ]}`);
    expect(convert("{% hash 'sha1' %}")).toBe(
      `\${[ hash.sha1(input=${encoded("")}, encoding='hex') ]}`,
    );
  });

  test("falls back to SHA-256 for algorithms outside Insomnia's list, as Insomnia does", () => {
    expect(convert("{% hash 'sha384', 'hex', 'text' %}")).toBe(
      `\${[ hash.sha256(input=${encoded("text")}, encoding='hex') ]}`,
    );
  });

  test("converts a cookie URL to the domain Yaak filters by", () => {
    expect(convert("{% cookie 'https://api.example.com/login', 'session' %}")).toBe(
      `\${[ cookie.value(name=${encoded("session")}, domain=${encoded("api.example.com")}) ]}`,
    );
  });

  test("keeps an unreadable cookie URL so it stays visible in the tag", () => {
    expect(convert("{% cookie '{{ _.base_url }}', 'session' %}")).toBe(
      `\${[ cookie.value(name=${encoded("session")}, domain=${encoded("${[ base_url ]}")}) ]}`,
    );
  });

  test("searches the whole jar when the cookie URL is empty", () => {
    expect(convert("{% cookie '', 'session' %}")).toBe(
      `\${[ cookie.value(name=${encoded("session")}) ]}`,
    );
  });

  test("converts a prompt with only a title", () => {
    expect(convert("{% prompt 'Password' %}")).toBe(
      `\${[ prompt.text(label=${encoded("Password")}, title=${encoded("Password")}) ]}`,
    );
  });

  test("converts every prompt argument with a Yaak counterpart", () => {
    expect(convert("{% prompt 'Login', 'Username', 'admin', 'user-key', false, true %}")).toBe(
      `\${[ prompt.text(label=${encoded("Username")}, store='forever', ` +
        `namespace=${encoded("${[ctx.workspace()]}")}, key=${encoded("user-key")}, ` +
        `title=${encoded("Login")}, defaultValue=${encoded("admin")}) ]}`,
    );
  });

  test("never stores a masked prompt, even with a storage key", () => {
    expect(convert("{% prompt 'Login', 'Password', 'hunter2', 'pw-key', true, true %}")).toBe(
      `\${[ prompt.text(label=${encoded("Password")}, title=${encoded("Login")}, ` +
        `defaultValue=${encoded("hunter2")}, password=true) ]}`,
    );
  });

  test("masks a prompt without a storage key", () => {
    expect(convert("{% prompt 'Login', 'Password', '', '', true %}")).toBe(
      `\${[ prompt.text(label=${encoded("Password")}, title=${encoded("Login")}, password=true) ]}`,
    );
  });

  test("leaves the prompt unmasked and unstored by default", () => {
    expect(convert("{% prompt 'Login', 'Password', '', '', false, true %}")).toBe(
      `\${[ prompt.text(label=${encoded("Password")}, title=${encoded("Login")}) ]}`,
    );
  });

  test("converts the two-argument response form", () => {
    expect(convert("{% response 'raw', 'req_login' %}")).toBe(
      `\${[ response.body.raw(request=${encoded("GENERATE_ID::req_login")}, behavior='never', ttl='0') ]}`,
    );
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
