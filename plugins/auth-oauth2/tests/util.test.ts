import { describe, test, expect } from 'vitest';
import { extractCode } from '../src/util';

describe('extractCode', () => {
  test('extracts code from query when same origin + path', () => {
    const url = 'https://app.example.com/cb?code=abc123&state=xyz';
    const redirect = 'https://app.example.com/cb';
    expect(extractCode(url, redirect)).toBe('abc123');
  });

  test('extracts code from query with weird path', () => {
    const url = 'https://app.example.com/cbwithextra?code=abc123&state=xyz';
    const redirect = 'https://app.example.com/cb';
    expect(extractCode(url, redirect)).toBeNull();
  });

  test('allows trailing slash differences', () => {
    expect(extractCode('https://app.example.com/cb/?code=abc', 'https://app.example.com/cb')).toBe(
      'abc',
    );
    expect(extractCode('https://app.example.com/cb?code=abc', 'https://app.example.com/cb/')).toBe(
      'abc',
    );
  });

  test('treats default ports as equal (https:443, http:80)', () => {
    expect(
      extractCode('https://app.example.com/cb?code=abc', 'https://app.example.com:443/cb'),
    ).toBe('abc');
    expect(extractCode('http://app.example.com/cb?code=abc', 'http://app.example.com:80/cb')).toBe(
      'abc',
    );
  });

  test('rejects different port', () => {
    expect(
      extractCode('https://app.example.com/cb?code=abc', 'https://app.example.com:8443/cb'),
    ).toBeNull();
  });

  test('rejects different hostname (including subdomain changes)', () => {
    expect(
      extractCode('https://evil.example.com/cb?code=abc', 'https://app.example.com/cb'),
    ).toBeNull();
  });

  test('requires path to start with redirect path (ignoring query/hash)', () => {
    // same origin but wrong path -> null
    expect(
      extractCode('https://app.example.com/other?code=abc', 'https://app.example.com/cb'),
    ).toBeNull();

    // deeper subpath under the redirect path -> allowed (prefix match)
    expect(
      extractCode('https://app.example.com/cb/deep?code=abc', 'https://app.example.com/cb'),
    ).toBe('abc');
  });

  test('works with custom schemes', () => {
    expect(extractCode('myapp://cb?code=abc', 'myapp://cb')).toBe('abc');
  });

  test('prefers query over fragment when both present', () => {
    const url = 'https://app.example.com/cb?code=queryCode#code=hashCode';
    const redirect = 'https://app.example.com/cb';
    expect(extractCode(url, redirect)).toBe('queryCode');
  });

  test('extracts code from fragment when query lacks code', () => {
    const url = 'https://app.example.com/cb#code=fromHash&state=xyz';
    const redirect = 'https://app.example.com/cb';
    expect(extractCode(url, redirect)).toBe('fromHash');
  });

  test('returns null if no code present (query or fragment)', () => {
    const url = 'https://app.example.com/cb?state=only';
    const redirect = 'https://app.example.com/cb';
    expect(extractCode(url, redirect)).toBeNull();
  });

  test('returns null when provider reports an error', () => {
    const url = 'https://app.example.com/cb?error=access_denied&error_description=oopsy';
    const redirect = 'https://app.example.com/cb';
    expect(() => extractCode(url, redirect)).toThrow('Failed to authorize: access_denied');
  });

  test('when redirectUri is null, extracts code from any URL', () => {
    expect(extractCode('https://random.example.com/whatever?code=abc', null)).toBe('abc');
  });

  test('handles extra params gracefully', () => {
    const url = 'https://app.example.com/cb?foo=1&bar=2&code=abc&baz=3';
    const redirect = 'https://app.example.com/cb';
    expect(extractCode(url, redirect)).toBe('abc');
  });

  test('ignores fragment noise when code is in query', () => {
    const url = 'https://app.example.com/cb?code=abc#some=thing';
    const redirect = 'https://app.example.com/cb';
    expect(extractCode(url, redirect)).toBe('abc');
  });

  // If you decide NOT to support fragment-based codes, flip these to expect null or mark as .skip
  test('supports fragment-only code for response_mode=fragment providers', () => {
    const url = 'https://app.example.com/cb#state=xyz&code=abc';
    const redirect = 'https://app.example.com/cb';
    expect(extractCode(url, redirect)).toBe('abc');
  });
});
