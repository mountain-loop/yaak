import type { Context } from '@yaakapp/api';
import { describe, expect, test } from 'vitest';
import { plugin } from '../src';

const ctx = {} as Context;

describe('auth-bearer', () => {
  test('No values', async () => {
    expect(
      await plugin.authentication!.onApply(ctx, {
        values: {},
        headers: [],
        url: 'https://yaak.app',
        method: 'POST',
        contextId: '111',
      }),
    ).toEqual({ setHeaders: [{ name: 'Authorization', value: '' }] });
  });

  test('Only token', async () => {
    expect(
      await plugin.authentication!.onApply(ctx, {
        values: { token: 'my-token' },
        headers: [],
        url: 'https://yaak.app',
        method: 'POST',
        contextId: '111',
      }),
    ).toEqual({ setHeaders: [{ name: 'Authorization', value: 'my-token' }] });
  });

  test('Only prefix', async () => {
    expect(
      await plugin.authentication!.onApply(ctx, {
        values: { prefix: 'Hello' },
        headers: [],
        url: 'https://yaak.app',
        method: 'POST',
        contextId: '111',
      }),
    ).toEqual({ setHeaders: [{ name: 'Authorization', value: 'Hello' }] });
  });

  test('Prefix and token', async () => {
    expect(
      await plugin.authentication!.onApply(ctx, {
        values: { prefix: 'Hello', token: 'my-token' },
        headers: [],
        url: 'https://yaak.app',
        method: 'POST',
        contextId: '111',
      }),
    ).toEqual({ setHeaders: [{ name: 'Authorization', value: 'Hello my-token' }] });
  });

  test('Extra spaces', async () => {
    expect(
      await plugin.authentication!.onApply(ctx, {
        values: { prefix: '\t Hello  ', token: ' \nmy-token  ' },
        headers: [],
        url: 'https://yaak.app',
        method: 'POST',
        contextId: '111',
      }),
    ).toEqual({ setHeaders: [{ name: 'Authorization', value: 'Hello my-token' }] });
  });
});
