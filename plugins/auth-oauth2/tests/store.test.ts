import { describe, expect, test } from "vite-plus/test";
import type { TokenStoreArgs } from "../src/store";
import { getToken, storeToken } from "../src/store";

function createMockContext() {
  const values = new Map<string, unknown>();

  return {
    store: {
      async set<T>(key: string, value: T) {
        values.set(key, value);
      },
      async get<T>(key: string) {
        return values.get(key) as T | undefined;
      },
    },
  } as never;
}

describe("token store", () => {
  test("separates password grant tokens when the username changes", async () => {
    const ctx = createMockContext();

    const aliceArgs: TokenStoreArgs = {
      contextId: "request-1",
      clientId: "client-123",
      accessTokenUrl: "https://auth.example.com/token",
      authorizationUrl: null,
      username: "alice@example.com",
    };
    const bobArgs: TokenStoreArgs = { ...aliceArgs, username: "bob@example.com" };

    await storeToken(ctx, aliceArgs, { access_token: "alice-token" });

    expect((await getToken(ctx, aliceArgs))?.response.access_token).toBe("alice-token");
    expect(await getToken(ctx, bobArgs)).toBeUndefined();
  });

  test("keeps the same key for grants without a username", async () => {
    const ctx = createMockContext();

    const args: TokenStoreArgs = {
      contextId: "request-1",
      clientId: "client-123",
      accessTokenUrl: "https://auth.example.com/token",
      authorizationUrl: null,
    };

    await storeToken(ctx, args, { access_token: "cc-token" });

    expect((await getToken(ctx, { ...args, username: null }))?.response.access_token).toBe(
      "cc-token",
    );
    expect((await getToken(ctx, { ...args, username: "" }))?.response.access_token).toBe("cc-token");
  });
});
