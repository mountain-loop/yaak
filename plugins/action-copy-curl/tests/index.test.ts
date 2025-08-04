import { describe, expect, test } from 'vitest';
import { convertToCurl } from '../src';

describe('exporter-curl', () => {
  test('Exports GET with params', async () => {
    expect(
      await convertToCurl({
        url: 'https://yaak.app',
        urlParameters: [
          { name: 'a', value: 'aaa' },
          { name: 'b', value: 'bbb', enabled: true },
          { name: 'c', value: 'ccc', enabled: false },
        ],
      }),
    ).toEqual(
      [`curl 'https://yaak.app?a=aaa&b=bbb'`].join(` \\n  `),
    );
  });

  test('Exports GET with params and hash', async () => {
    expect(
      await convertToCurl({
        url: 'https://yaak.app/path#section',
        urlParameters: [
          { name: 'a', value: 'aaa' },
          { name: 'b', value: 'bbb', enabled: true },
          { name: 'c', value: 'ccc', enabled: false },
        ],
      }),
    ).toEqual(
      [`curl 'https://yaak.app/path?a=aaa&b=bbb#section'`].join(` \\n  `),
    );
  });
  test('Exports POST with url form data', async () => {
    expect(
      await convertToCurl({
        url: 'https://yaak.app',
        method: 'POST',
        bodyType: 'application/x-www-form-urlencoded',
        body: {
          form: [
            { name: 'a', value: 'aaa' },
            { name: 'b', value: 'bbb', enabled: true },
            { name: 'c', value: 'ccc', enabled: false },
          ],
        },
      }),
    ).toEqual(
      [`curl -X POST 'https://yaak.app'`, `--data 'a=aaa'`, `--data 'b=bbb'`].join(` \\\n  `),
    );
  });

  test('Exports POST with GraphQL data', async () => {
    expect(
      await convertToCurl({
        url: 'https://yaak.app',
        method: 'POST',
        bodyType: 'graphql',
        body: {
          query: '{foo,bar}',
          variables: '{"a": "aaa", "b": "bbb"}',
        },
      }),
    ).toEqual(
      [`curl -X POST 'https://yaak.app'`, `--data '{"query":"{foo,bar}","variables":{"a":"aaa","b":"bbb"}}'`].join(` \\\n  `),
    );
  });

  test('Exports POST with GraphQL data no variables', async () => {
    expect(
      await convertToCurl({
        url: 'https://yaak.app',
        method: 'POST',
        bodyType: 'graphql',
        body: {
          query: '{foo,bar}',
        },
      }),
    ).toEqual(
      [`curl -X POST 'https://yaak.app'`, `--data '{"query":"{foo,bar}"}'`].join(` \\\n  `),
    );
  });

  test('Exports PUT with multipart form', async () => {
    expect(
      await convertToCurl({
        url: 'https://yaak.app',
        method: 'PUT',
        bodyType: 'multipart/form-data',
        body: {
          form: [
            { name: 'a', value: 'aaa' },
            { name: 'b', value: 'bbb', enabled: true },
            { name: 'c', value: 'ccc', enabled: false },
            { name: 'f', file: '/foo/bar.png', contentType: 'image/png' },
          ],
        },
      }),
    ).toEqual(
      [
        `curl -X PUT 'https://yaak.app'`,
        `--form 'a=aaa'`,
        `--form 'b=bbb'`,
        `--form f=@/foo/bar.png;type=image/png`,
      ].join(` \\\n  `),
    );
  });

  test('Exports JSON body', async () => {
    expect(
      await convertToCurl({
        url: 'https://yaak.app',
        method: 'POST',
        bodyType: 'application/json',
        body: {
          text: `{"foo":"bar's"}`,
        },
        headers: [{ name: 'Content-Type', value: 'application/json' }],
      }),
    ).toEqual(
      [
        `curl -X POST 'https://yaak.app'`,
        `--header 'Content-Type: application/json'`,
        `--data '{"foo":"bar\\'s"}'`,
      ].join(` \\\n  `),
    );
  });

  test('Exports multi-line JSON body', async () => {
    expect(
      await convertToCurl({
        url: 'https://yaak.app',
        method: 'POST',
        bodyType: 'application/json',
        body: {
          text: `{"foo":"bar",\n"baz":"qux"}`,
        },
        headers: [{ name: 'Content-Type', value: 'application/json' }],
      }),
    ).toEqual(
      [
        `curl -X POST 'https://yaak.app'`,
        `--header 'Content-Type: application/json'`,
        `--data '{"foo":"bar",\n"baz":"qux"}'`,
      ].join(` \\\n  `),
    );
  });

  test('Exports headers', async () => {
    expect(
      await convertToCurl({
        headers: [
          { name: 'a', value: 'aaa' },
          { name: 'b', value: 'bbb', enabled: true },
          { name: 'c', value: 'ccc', enabled: false },
        ],
      }),
    ).toEqual([`curl ''`, `--header 'a: aaa'`, `--header 'b: bbb'`].join(` \\\n  `));
  });

  test('Basic auth', async () => {
    expect(
      await convertToCurl({
        url: 'https://yaak.app',
        authenticationType: 'basic',
        authentication: {
          username: 'user',
          password: 'pass',
        },
      }),
    ).toEqual([`curl 'https://yaak.app'`, `--user 'user:pass'`].join(` \\\n  `));
  });

  test('Broken basic auth', async () => {
    expect(
      await convertToCurl({
        url: 'https://yaak.app',
        authenticationType: 'basic',
        authentication: {},
      }),
    ).toEqual([`curl 'https://yaak.app'`, `--user ':'`].join(` \\\n  `));
  });

  test('Digest auth', async () => {
    expect(
      await convertToCurl({
        url: 'https://yaak.app',
        authenticationType: 'digest',
        authentication: {
          username: 'user',
          password: 'pass',
        },
      }),
    ).toEqual([`curl 'https://yaak.app'`, `--digest --user 'user:pass'`].join(` \\\n  `));
  });

  test('Bearer auth', async () => {
    expect(
      await convertToCurl({
        url: 'https://yaak.app',
        authenticationType: 'bearer',
        authentication: {
          token: 'tok',
        },
      }),
    ).toEqual([`curl 'https://yaak.app'`, `--header 'Authorization: Bearer tok'`].join(` \\\n  `));
  });

  test('Broken bearer auth', async () => {
    expect(
      await convertToCurl({
        url: 'https://yaak.app',
        authenticationType: 'bearer',
        authentication: {
          username: 'user',
          password: 'pass',
        },
      }),
    ).toEqual([`curl 'https://yaak.app'`, `--header 'Authorization: Bearer '`].join(` \\\n  `));
  });

  test('Stale body data', async () => {
    expect(
      await convertToCurl({
        url: 'https://yaak.app',
        bodyType: 'none',
        body: {
          text: 'ignore me',
        }
      }),
    ).toEqual([`curl 'https://yaak.app'`].join(` \\\n  `));
  });
});
