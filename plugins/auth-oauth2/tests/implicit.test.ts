import { describe, expect, test } from "vite-plus/test";
import { getImplicit } from "../src/grants/implicit";

const REDIRECT_URI = "https://app.example.com/callback";

function createMockContext(tokenFragment: string) {
  const opened: string[] = [];
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
        setTimeout(() => onNavigate({ url: `${REDIRECT_URI}#${tokenFragment}` }), 0);
        return { close() {} };
      },
    },
  } as never;

  return { ctx, opened };
}

const baseArgs = {
  authorizationUrl: "https://auth.example.com/authorize",
  clientId: "client-123",
  redirectUri: REDIRECT_URI,
  scope: "openid",
  state: null,
  audience: null,
  tokenName: "id_token" as const,
};

describe("implicit grant nonce", () => {
  test("generates a distinct 32-char hex cryptographic nonce for id_token requests", async () => {
    const first = createMockContext("id_token=tok-1&token_type=Bearer");
    await getImplicit(first.ctx, "request-1", {
      ...baseArgs,
      responseType: "id_token token",
    });

    const second = createMockContext("id_token=tok-2&token_type=Bearer");
    await getImplicit(second.ctx, "request-2", {
      ...baseArgs,
      responseType: "id_token",
    });

    const nonce1 = new URL(first.opened[0]!).searchParams.get("nonce");
    const nonce2 = new URL(second.opened[0]!).searchParams.get("nonce");

    expect(nonce1).toMatch(/^[0-9a-f]{32}$/);
    expect(nonce2).toMatch(/^[0-9a-f]{32}$/);
    expect(nonce1).not.toBe(nonce2);
  });

  test("omits nonce when responseType does not request an id_token", async () => {
    const { ctx, opened } = createMockContext("access_token=tok-1&token_type=Bearer");
    await getImplicit(ctx, "request-3", {
      ...baseArgs,
      responseType: "token",
      tokenName: "access_token",
    });

    expect(new URL(opened[0]!).searchParams.has("nonce")).toBe(false);
  });
});
