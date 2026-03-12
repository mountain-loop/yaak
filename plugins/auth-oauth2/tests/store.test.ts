import { describe, expect, test } from 'vitest';
import { getToken, storeToken } from '../src/store';

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
  } as any;
}

describe('token store', () => {
  test('separates password grant tokens when credentials change', async () => {
    const ctx = createMockContext();

    const aliceArgs = {
      contextId: 'request-1',
      clientId: 'client-123',
      accessTokenUrl: 'https://auth.example.com/token',
      authorizationUrl: null,
      username: 'alice@example.com',
      password: 'secret',
    };
    const bobArgs = {
      contextId: 'request-1',
      clientId: 'client-123',
      accessTokenUrl: 'https://auth.example.com/token',
      authorizationUrl: null,
      username: 'bob@example.com',
      password: 'secret',
    };

    await storeToken(ctx, aliceArgs, { access_token: 'alice-token' });

    expect((await getToken(ctx, aliceArgs))?.response.access_token).toBe('alice-token');
    expect(await getToken(ctx, bobArgs)).toBeUndefined();
  });
});