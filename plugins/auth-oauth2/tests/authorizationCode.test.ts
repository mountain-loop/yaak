import type { HttpRequest } from "@yaakapp/api";
import { describe, expect, test } from "vite-plus/test";
import { readCustomParams } from "../src/customParams";
import { getAuthorizationCode } from "../src/grants/authorizationCode";

const REDIRECT_URI = "https://app.example.com/callback";

/**
 * Drives the embedded-browser flow: records the authorization URL the plugin
 * opens, then navigates straight to the redirect with a code.
 */
function createMockContext() {
  const opened: string[] = [];
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
    },
    window: {
      async openUrl({
        url,
        onNavigate,
      }: {
        url: string;
        onNavigate: (e: { url: string }) => Promise<void>;
      }) {
        opened.push(url);
        // Deferred because onNavigate closes the window it is handed back from
        setTimeout(() => onNavigate({ url: `${REDIRECT_URI}?code=code-123` }), 0);
        return { close() {} };
      },
    },
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

  return { ctx, opened, sent };
}

const baseArgs = {
  authorizationUrl: "https://auth.example.com/authorize",
  accessTokenUrl: "https://auth.example.com/token",
  clientId: "client-123",
  clientSecret: "secret",
  redirectUri: REDIRECT_URI,
  scope: "openid",
  state: null,
  audience: null,
  credentialsInBody: true,
  pkce: null,
  tokenName: "access_token" as const,
};

function pairs(...rows: { name: string; value: string; enabled?: boolean }[]) {
  return JSON.stringify(rows.map((r) => ({ enabled: true, ...r })));
}

describe("authorization code custom parameters", () => {
  test("puts custom authorization params on the authorize URL", async () => {
    const { ctx, opened } = createMockContext();

    await getAuthorizationCode(ctx, "request-1", {
      ...baseArgs,
      customParams: readCustomParams({
        authorizationParams: pairs(
          { name: "prompt", value: "consent" },
          { name: "realm", value: "employees" },
          { name: "skipped", value: "nope", enabled: false },
        ),
      }),
    });

    const url = new URL(opened[0]!);
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("realm")).toBe("employees");
    expect(url.searchParams.has("skipped")).toBe(false);
    // Generated params are still there
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("client-123");
    expect(url.searchParams.get("scope")).toBe("openid");
    expect(url.searchParams.get("redirect_uri")).toBe(REDIRECT_URI);
  });

  test("keeps the flow's redirect_uri when a custom param tries to change it", async () => {
    const { ctx, opened } = createMockContext();

    await getAuthorizationCode(ctx, "request-1", {
      ...baseArgs,
      customParams: readCustomParams({
        authorizationParams: pairs({ name: "redirect_uri", value: "https://evil.example.com" }),
      }),
    });

    expect(new URL(opened[0]!).searchParams.get("redirect_uri")).toBe(REDIRECT_URI);
  });

  test("sends custom token entries with the exchange that follows", async () => {
    const { ctx, sent } = createMockContext();

    await getAuthorizationCode(ctx, "request-1", {
      ...baseArgs,
      customParams: readCustomParams({
        tokenHeaders: pairs(
          { name: "Origin", value: "https://app.example.com" },
          { name: "X-Skipped", value: "nope", enabled: false },
        ),
        tokenBodyParams: pairs({ name: "realm", value: "employees" }),
      }),
    });

    const headers = sent[0]!.headers ?? [];
    expect(headers).toContainEqual({ name: "Origin", value: "https://app.example.com" });
    expect(headers.map((h: { name: string }) => h.name)).not.toContain("X-Skipped");

    const form = sent[0]!.body?.form ?? [];
    expect(form).toContainEqual({ name: "realm", value: "employees" });
    expect(form).toContainEqual({ name: "code", value: "code-123" });
  });
});
