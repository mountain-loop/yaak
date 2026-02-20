import type { Context } from '@yaakapp/api';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const ntlmMock = vi.hoisted(() => ({
  createType1Message: vi.fn(),
  parseType2Message: vi.fn(),
  createType3Message: vi.fn(),
}));

vi.mock('httpntlm', () => ({ ntlm: ntlmMock }));

import { plugin } from '../src';

describe('auth-ntlm', () => {
  beforeEach(() => {
    ntlmMock.createType1Message.mockReset();
    ntlmMock.parseType2Message.mockReset();
    ntlmMock.createType3Message.mockReset();
    ntlmMock.createType1Message.mockReturnValue('NTLM TYPE1');
    ntlmMock.parseType2Message.mockReturnValue({} as any);
    ntlmMock.createType3Message.mockReturnValue('NTLM TYPE3');
  });

  test('uses NTLM challenge when Negotiate and NTLM headers are separate', async () => {
    const send = vi.fn().mockResolvedValue({
      headers: [
        { name: 'WWW-Authenticate', value: 'Negotiate' },
        { name: 'WWW-Authenticate', value: 'NTLM TlRMTVNTUAACAAAAAA==' },
      ],
    });
    const ctx = { httpRequest: { send } } as unknown as Context;

    const result = await plugin.authentication?.onApply(ctx, {
      values: {},
      headers: [],
      url: 'https://example.local/resource',
      method: 'GET',
      contextId: 'ctx',
    });

    expect(ntlmMock.parseType2Message).toHaveBeenCalledWith(
      'NTLM TlRMTVNTUAACAAAAAA==',
      expect.any(Function),
    );
    expect(result).toEqual({ setHeaders: [{ name: 'Authorization', value: 'NTLM TYPE3' }] });
  });

  test('uses NTLM challenge when auth schemes are comma-separated in one header', async () => {
    const send = vi.fn().mockResolvedValue({
      headers: [{ name: 'www-authenticate', value: 'Negotiate, NTLM TlRMTVNTUAACAAAAAA==' }],
    });
    const ctx = { httpRequest: { send } } as unknown as Context;

    await plugin.authentication?.onApply(ctx, {
      values: {},
      headers: [],
      url: 'https://example.local/resource',
      method: 'GET',
      contextId: 'ctx',
    });

    expect(ntlmMock.parseType2Message).toHaveBeenCalledWith(
      'NTLM TlRMTVNTUAACAAAAAA==',
      expect.any(Function),
    );
  });

  test('throws a clear error when NTLM challenge is missing', async () => {
    const send = vi.fn().mockResolvedValue({
      headers: [{ name: 'WWW-Authenticate', value: 'Negotiate' }],
    });
    const ctx = { httpRequest: { send } } as unknown as Context;

    await expect(
      plugin.authentication?.onApply(ctx, {
        values: {},
        headers: [],
        url: 'https://example.local/resource',
        method: 'GET',
        contextId: 'ctx',
      }),
    ).rejects.toThrow('Unable to find NTLM challenge in WWW-Authenticate response headers');
  });
});
