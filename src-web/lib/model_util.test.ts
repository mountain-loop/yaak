import type { HttpResponseEvent } from '@yaakapp-internal/models';
import { describe, expect, test } from 'vitest';
import { getCookieCounts } from './model_util';

function makeEvent(
  type: string,
  name: string,
  value: string,
): HttpResponseEvent {
  return {
    id: 'test',
    model: 'http_response_event',
    responseId: 'resp',
    workspaceId: 'ws',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    event: { type, name, value } as HttpResponseEvent['event'],
  };
}

describe('getCookieCounts', () => {
  test('returns zeros for undefined events', () => {
    expect(getCookieCounts(undefined)).toEqual({ sent: 0, received: 0 });
  });

  test('returns zeros for empty events', () => {
    expect(getCookieCounts([])).toEqual({ sent: 0, received: 0 });
  });

  test('counts single sent cookie', () => {
    const events = [makeEvent('header_up', 'Cookie', 'session=abc123')];
    expect(getCookieCounts(events)).toEqual({ sent: 1, received: 0 });
  });

  test('counts multiple sent cookies in one header', () => {
    const events = [makeEvent('header_up', 'Cookie', 'a=1; b=2; c=3')];
    expect(getCookieCounts(events)).toEqual({ sent: 3, received: 0 });
  });

  test('counts single received cookie', () => {
    const events = [makeEvent('header_down', 'Set-Cookie', 'session=abc123; Path=/')];
    expect(getCookieCounts(events)).toEqual({ sent: 0, received: 1 });
  });

  test('counts multiple received cookies from multiple headers', () => {
    const events = [
      makeEvent('header_down', 'Set-Cookie', 'a=1; Path=/'),
      makeEvent('header_down', 'Set-Cookie', 'b=2; HttpOnly'),
      makeEvent('header_down', 'Set-Cookie', 'c=3; Secure'),
    ];
    expect(getCookieCounts(events)).toEqual({ sent: 0, received: 3 });
  });

  test('deduplicates sent cookies by name', () => {
    const events = [
      makeEvent('header_up', 'Cookie', 'session=old'),
      makeEvent('header_up', 'Cookie', 'session=new'),
    ];
    expect(getCookieCounts(events)).toEqual({ sent: 1, received: 0 });
  });

  test('deduplicates received cookies by name', () => {
    const events = [
      makeEvent('header_down', 'Set-Cookie', 'token=abc; Path=/'),
      makeEvent('header_down', 'Set-Cookie', 'token=xyz; Path=/'),
    ];
    expect(getCookieCounts(events)).toEqual({ sent: 0, received: 1 });
  });

  test('counts both sent and received cookies', () => {
    const events = [
      makeEvent('header_up', 'Cookie', 'a=1; b=2; c=3'),
      makeEvent('header_down', 'Set-Cookie', 'x=10; Path=/'),
      makeEvent('header_down', 'Set-Cookie', 'y=20; Path=/'),
      makeEvent('header_down', 'Set-Cookie', 'z=30; Path=/'),
    ];
    expect(getCookieCounts(events)).toEqual({ sent: 3, received: 3 });
  });

  test('ignores non-cookie headers', () => {
    const events = [
      makeEvent('header_up', 'Content-Type', 'application/json'),
      makeEvent('header_down', 'Content-Length', '123'),
    ];
    expect(getCookieCounts(events)).toEqual({ sent: 0, received: 0 });
  });

  test('handles case-insensitive header names', () => {
    const events = [
      makeEvent('header_up', 'COOKIE', 'a=1'),
      makeEvent('header_down', 'SET-COOKIE', 'b=2; Path=/'),
    ];
    expect(getCookieCounts(events)).toEqual({ sent: 1, received: 1 });
  });
});
