import type { Context } from '@yaakapp/api';
import { describe, expect, test } from 'vitest';
import { plugin } from '../src';

const ctx = {} as Context;

describe('auth-basic', () => {
  test('Both username and password', async () => {
    expect(
      await plugin.authentication?.onApply(ctx, {
        values: { username: 'user', password: 'pass' },
        headers: [],
        url: 'https://yaak.app',
        method: 'POST',
        contextId: '111',
      }),
    ).toEqual({
      setHeaders: [{ name: 'Authorization', value: `Basic ${Buffer.from('user:pass').toString('base64')}` }],
    });
  });

  test('Empty password', async () => {
    expect(
      await plugin.authentication?.onApply(ctx, {
        values: { username: 'apikey', password: '' },
        headers: [],
        url: 'https://yaak.app',
        method: 'POST',
        contextId: '111',
      }),
    ).toEqual({
      setHeaders: [{ name: 'Authorization', value: `Basic ${Buffer.from('apikey:').toString('base64')}` }],
    });
  });

  test('Missing password (undefined)', async () => {
    expect(
      await plugin.authentication?.onApply(ctx, {
        values: { username: 'apikey' },
        headers: [],
        url: 'https://yaak.app',
        method: 'POST',
        contextId: '111',
      }),
    ).toEqual({
      setHeaders: [{ name: 'Authorization', value: `Basic ${Buffer.from('apikey:').toString('base64')}` }],
    });
  });

  test('Missing username (undefined)', async () => {
    expect(
      await plugin.authentication?.onApply(ctx, {
        values: { password: 'secret' },
        headers: [],
        url: 'https://yaak.app',
        method: 'POST',
        contextId: '111',
      }),
    ).toEqual({
      setHeaders: [{ name: 'Authorization', value: `Basic ${Buffer.from(':secret').toString('base64')}` }],
    });
  });

  test('No values (both undefined)', async () => {
    expect(
      await plugin.authentication?.onApply(ctx, {
        values: {},
        headers: [],
        url: 'https://yaak.app',
        method: 'POST',
        contextId: '111',
      }),
    ).toEqual({
      setHeaders: [{ name: 'Authorization', value: `Basic ${Buffer.from(':').toString('base64')}` }],
    });
  });
});
