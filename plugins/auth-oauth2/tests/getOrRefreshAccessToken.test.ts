import type { HttpRequest } from "@yaakapp/api";
import { describe, expect, test } from "vite-plus/test";
import { getOrRefreshAccessToken } from "../src/getOrRefreshAccessToken";
import type { TokenStoreArgs } from "../src/store";
import { storeToken } from "../src/store";

/**
 * Captures the refresh request handed to ctx.httpRequest.send and replies with
 * a minimal successful token response.
 */
function createMockContext() {
  const sent: Partial<HttpRequest>[] = [];
  const values = new Map<string, unknown>();

  const ctx = {
    store: {
      async set<T>(key: string, value: T) {
        values.set(key, value);
      },
      async get<T>(key: string) {
        return values.get(key) as T | undefined;
      },
      async delete(key: string) {
        return values.delete(key);
      },
    },
    httpRequest: {
      async send({ httpRequest }: { httpRequest: Partial<HttpRequest> }) {
        sent.push(httpRequest);
        return {
          httpResponse: { status: 200, error: null },
          body: {
            async text() {
              return JSON.stringify({ access_token: "refreshed-token" });
            },
          },
        };
      },
    },
  } as never;

  return { ctx, sent };
}

const tokenArgs: TokenStoreArgs = {
  contextId: "request-1",
  clientId: "client-123",
  accessTokenUrl: "https://auth.example.com/token",
  authorizationUrl: null,
};

const refreshArgs = {
  accessTokenUrl: "https://auth.example.com/token",
  scope: "openid",
  clientId: "client-123",
  clientSecret: "secret",
  credentialsInBody: true,
  forceRefresh: true,
};

function headerValue(httpRequest: Partial<HttpRequest>, name: string) {
  return (httpRequest.headers ?? []).find(
    (h: { name: string }) => h.name.toLowerCase() === name.toLowerCase(),
  )?.value;
}

function formValue(httpRequest: Partial<HttpRequest>, name: string) {
  return (httpRequest.body?.form ?? []).find((p: { name: string }) => p.name === name)?.value;
}

async function seedToken(ctx: never) {
  await storeToken(ctx, tokenArgs, {
    access_token: "old-token",
    refresh_token: "refresh-123",
  });
}

describe("getOrRefreshAccessToken custom parameters", () => {
  test("sends custom headers and body params with the refresh request", async () => {
    const { ctx, sent } = createMockContext();
    await seedToken(ctx);

    const token = await getOrRefreshAccessToken(ctx, tokenArgs, {
      ...refreshArgs,
      custom: {
        headers: [{ name: "Origin", value: "https://app.example.com" }],
        body: [{ name: "realm", value: "employees" }],
      },
    });

    expect(token?.response.access_token).toBe("refreshed-token");
    expect(headerValue(sent[0]!, "Origin")).toBe("https://app.example.com");
    expect(formValue(sent[0]!, "realm")).toBe("employees");
    // Generated entries survive
    expect(headerValue(sent[0]!, "User-Agent")).toBe("yaak");
    expect(formValue(sent[0]!, "grant_type")).toBe("refresh_token");
    expect(formValue(sent[0]!, "refresh_token")).toBe("refresh-123");
    expect(formValue(sent[0]!, "client_secret")).toBe("secret");
  });

  test("replaces generated entries of the same name", async () => {
    const { ctx, sent } = createMockContext();
    await seedToken(ctx);

    await getOrRefreshAccessToken(ctx, tokenArgs, {
      ...refreshArgs,
      custom: {
        headers: [{ name: "user-agent", value: "custom-agent" }],
        body: [{ name: "scope", value: "custom-scope" }],
      },
    });

    const userAgents = (sent[0]!.headers ?? []).filter(
      (h: { name: string }) => h.name.toLowerCase() === "user-agent",
    );
    expect(userAgents).toEqual([{ name: "user-agent", value: "custom-agent" }]);

    const scopes = (sent[0]!.body?.form ?? []).filter((p: { name: string }) => p.name === "scope");
    expect(scopes).toEqual([{ name: "scope", value: "custom-scope" }]);
  });

  test("sends the generated request untouched with no custom parameters", async () => {
    const { ctx, sent } = createMockContext();
    await seedToken(ctx);

    await getOrRefreshAccessToken(ctx, tokenArgs, refreshArgs);

    expect((sent[0]!.headers ?? []).map((h: { name: string }) => h.name)).toEqual([
      "User-Agent",
      "Accept",
      "Content-Type",
    ]);
    expect((sent[0]!.body?.form ?? []).map((p: { name: string }) => p.name)).toEqual([
      "grant_type",
      "refresh_token",
      "scope",
      "client_id",
      "client_secret",
    ]);
  });
});
