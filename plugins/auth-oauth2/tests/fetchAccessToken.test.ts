import type { HttpRequest } from "@yaakapp/api";
import { describe, expect, test } from "vite-plus/test";
import { fetchAccessToken } from "../src/fetchAccessToken";

/**
 * Captures the request handed to ctx.httpRequest.send so tests can assert on the
 * form body, and replies with a minimal successful token response.
 */
function createMockContext() {
  const sent: Partial<HttpRequest>[] = [];

  const ctx = {
    httpRequest: {
      async send({ httpRequest }: { httpRequest: Partial<HttpRequest> }) {
        sent.push(httpRequest);
        return {
          httpResponse: { status: 200, error: null },
          body: {
            async text() {
              return JSON.stringify({ access_token: "token-123" });
            },
          },
        };
      },
    },
  } as never;

  return { ctx, sent };
}

function formNames(httpRequest: Partial<HttpRequest>) {
  return (httpRequest.body?.form ?? []).map((p: { name: string }) => p.name);
}

function formValue(httpRequest: Partial<HttpRequest>, name: string) {
  return (httpRequest.body?.form ?? []).find((p: { name: string }) => p.name === name)?.value;
}

function headerValue(httpRequest: Partial<HttpRequest>, name: string) {
  return (httpRequest.headers ?? []).find(
    (h: { name: string }) => h.name.toLowerCase() === name.toLowerCase(),
  )?.value;
}

const baseArgs = {
  clientId: "client-123",
  accessTokenUrl: "https://auth.example.com/token",
  scope: "openid profile",
  audience: null,
  clientSecret: "secret",
  credentialsInBody: true,
  params: [],
};

describe("fetchAccessToken scope handling", () => {
  test("omits scope for the authorization code grant", async () => {
    const { ctx, sent } = createMockContext();

    await fetchAccessToken(ctx, {
      ...baseArgs,
      grantType: "authorization_code",
      params: [{ name: "code", value: "abc" }],
    });

    expect(formNames(sent[0]!)).not.toContain("scope");
    // The rest of the request is untouched
    expect(formValue(sent[0]!, "grant_type")).toBe("authorization_code");
    expect(formValue(sent[0]!, "code")).toBe("abc");
  });

  test("sends scope for the client credentials grant", async () => {
    const { ctx, sent } = createMockContext();

    await fetchAccessToken(ctx, { ...baseArgs, grantType: "client_credentials" });

    expect(formValue(sent[0]!, "scope")).toBe("openid profile");
  });

  test("sends scope for the password grant", async () => {
    const { ctx, sent } = createMockContext();

    await fetchAccessToken(ctx, { ...baseArgs, grantType: "password" });

    expect(formValue(sent[0]!, "scope")).toBe("openid profile");
  });

  test("still sends audience for the authorization code grant", async () => {
    const { ctx, sent } = createMockContext();

    await fetchAccessToken(ctx, {
      ...baseArgs,
      grantType: "authorization_code",
      audience: "https://api.example.com",
    });

    expect(formValue(sent[0]!, "audience")).toBe("https://api.example.com");
    expect(formNames(sent[0]!)).not.toContain("scope");
  });
});

describe("fetchAccessToken custom parameters", () => {
  test("sends a custom header with the token request", async () => {
    const { ctx, sent } = createMockContext();

    await fetchAccessToken(ctx, {
      ...baseArgs,
      grantType: "authorization_code",
      custom: {
        headers: [{ name: "Origin", value: "https://app.example.com" }],
        body: [],
      },
    });

    expect(headerValue(sent[0]!, "Origin")).toBe("https://app.example.com");
  });

  test("keeps the generated headers that are not overridden", async () => {
    const { ctx, sent } = createMockContext();

    await fetchAccessToken(ctx, {
      ...baseArgs,
      grantType: "client_credentials",
      credentialsInBody: false,
      custom: {
        headers: [{ name: "Origin", value: "https://app.example.com" }],
        body: [],
      },
    });

    expect(headerValue(sent[0]!, "User-Agent")).toBe("yaak");
    expect(headerValue(sent[0]!, "Content-Type")).toBe("application/x-www-form-urlencoded");
    expect(headerValue(sent[0]!, "Accept")).toBe(
      "application/x-www-form-urlencoded, application/json",
    );
    // Basic credentials still go out untouched
    expect(headerValue(sent[0]!, "Authorization")).toMatch(/^Basic /);
  });

  test("replaces a generated header of the same name", async () => {
    const { ctx, sent } = createMockContext();

    await fetchAccessToken(ctx, {
      ...baseArgs,
      grantType: "client_credentials",
      credentialsInBody: false,
      custom: {
        headers: [
          { name: "content-type", value: "application/json" },
          { name: "Authorization", value: "Custom abc123" },
        ],
        body: [],
      },
    });

    const contentTypes = (sent[0]!.headers ?? []).filter(
      (h: { name: string }) => h.name.toLowerCase() === "content-type",
    );
    expect(contentTypes).toEqual([{ name: "content-type", value: "application/json" }]);
    expect(headerValue(sent[0]!, "Authorization")).toBe("Custom abc123");
  });

  test("sends custom body params in the form-encoded body", async () => {
    const { ctx, sent } = createMockContext();

    await fetchAccessToken(ctx, {
      ...baseArgs,
      grantType: "password",
      params: [{ name: "username", value: "alice" }],
      custom: {
        headers: [],
        body: [{ name: "realm", value: "employees" }],
      },
    });

    expect(sent[0]!.bodyType).toBe("application/x-www-form-urlencoded");
    expect(formValue(sent[0]!, "realm")).toBe("employees");
    // Generated params survive alongside it
    expect(formValue(sent[0]!, "grant_type")).toBe("password");
    expect(formValue(sent[0]!, "username")).toBe("alice");
    expect(formValue(sent[0]!, "client_id")).toBe("client-123");
  });

  test("replaces a generated body param of the same name", async () => {
    const { ctx, sent } = createMockContext();

    await fetchAccessToken(ctx, {
      ...baseArgs,
      grantType: "client_credentials",
      custom: {
        headers: [],
        body: [{ name: "scope", value: "custom-scope" }],
      },
    });

    expect(formNames(sent[0]!).filter((n: string) => n === "scope")).toHaveLength(1);
    expect(formValue(sent[0]!, "scope")).toBe("custom-scope");
  });
});
