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
