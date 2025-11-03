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
    ).toEqual([`curl 'https://yaak.app?a=aaa&b=bbb'`].join(` \\n  `));
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
    ).toEqual([`curl 'https://yaak.app/path?a=aaa&b=bbb#section'`].join(` \\n  `));
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
      [
        `curl -X POST 'https://yaak.app'`,
        `--data '{"query":"{foo,bar}","variables":{"a":"aaa","b":"bbb"}}'`,
      ].join(` \\\n  `),
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

  test('Basic auth disabled', async () => {
    expect(
      await convertToCurl({
        url: 'https://yaak.app',
        authenticationType: 'basic',
        authentication: {
          disabled: true,
          username: 'user',
          password: 'pass',
        },
      }),
    ).toEqual([`curl 'https://yaak.app'`].join(` \\\n  `));
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

  test('Bearer auth with custom prefix', async () => {
    expect(
      await convertToCurl({
        url: 'https://yaak.app',
        authenticationType: 'bearer',
        authentication: {
          token: 'abc123',
          prefix: 'Token',
        },
      }),
    ).toEqual(
      [`curl 'https://yaak.app'`, `--header 'Authorization: Token abc123'`].join(` \\\n  `),
    );
  });

  test('Bearer auth with empty prefix', async () => {
    expect(
      await convertToCurl({
        url: 'https://yaak.app',
        authenticationType: 'bearer',
        authentication: {
          token: 'xyz789',
          prefix: '',
        },
      }),
    ).toEqual([`curl 'https://yaak.app'`, `--header 'Authorization: xyz789'`].join(` \\\n  `));
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
    ).toEqual([`curl 'https://yaak.app'`, `--header 'Authorization: Bearer'`].join(` \\\n  `));
  });

  test('AWS v4 auth', async () => {
    expect(
      await convertToCurl({
        url: 'https://yaak.app',
        authenticationType: 'auth-aws-sig-v4',
        authentication: {
          accessKeyId: 'ak',
          secretAccessKey: 'sk',
          sessionToken: '',
          region: 'us-east-1',
          service: 's3',
        },
      }),
    ).toEqual(
      [
        `curl 'https://yaak.app'`,
        `--aws-sigv4 aws:amz:us-east-1:s3`,
        `--user 'ak:sk'`,
      ].join(` \\\n  `),
    );
  });

  test('AWS v4 auth with session', async () => {
    expect(
      await convertToCurl({
        url: 'https://yaak.app',
        authenticationType: 'auth-aws-sig-v4',
        authentication: {
          accessKeyId: 'ak',
          secretAccessKey: 'sk',
          sessionToken: 'st',
          region: 'us-east-1',
          service: 's3',
        },
      }),
    ).toEqual(
      [
        `curl 'https://yaak.app'`,
        `--aws-sigv4 aws:amz:us-east-1:s3`,
        `--user 'ak:sk'`,
        `--header 'X-Amz-Security-Token: st'`,
      ].join(` \\\n  `),
    );
  });

  test('API key auth header', async () => {
    expect(
      await convertToCurl({
        url: 'https://yaak.app',
        authenticationType: 'apikey',
        authentication: {
          location: 'header',
          key: 'X-Header',
          value: 'my-token'
        },
      }),
    ).toEqual(
      [
        `curl 'https://yaak.app'`,
        `--header 'X-Header: my-token'`,
      ].join(` \\\n  `),
    );
  });

  test('API key auth header default', async () => {
    expect(
      await convertToCurl({
        url: 'https://yaak.app',
        authenticationType: 'apikey',
        authentication: {
          location: 'header',
        },
      }),
    ).toEqual(
      [
        `curl 'https://yaak.app'`,
        `--header 'X-Api-Key: '`,
      ].join(` \\\n  `),
    );
  });

  test('API key auth query', async () => {
    expect(
      await convertToCurl({
        url: 'https://yaak.app',
        authenticationType: 'apikey',
        authentication: {
          location: 'query',
          key: 'foo',
          value: 'bar-baz'
        },
      }),
    ).toEqual(
      [
        `curl 'https://yaak.app?foo=bar-baz'`,
      ].join(` \\\n  `),
    );
  });

  test('API key auth query with existing', async () => {
    expect(
      await convertToCurl({
        url: 'https://yaak.app?foo=bar&baz=qux',
        authenticationType: 'apikey',
        authentication: {
          location: 'query',
          key: 'hi',
          value: 'there'
        },
      }),
    ).toEqual(
      [
        `curl 'https://yaak.app?foo=bar&baz=qux&hi=there'`,
      ].join(` \\\n  `),
    );
  });

  test('API key auth query default', async () => {
    expect(
      await convertToCurl({
        url: 'https://yaak.app?foo=bar&baz=qux',
        authenticationType: 'apikey',
        authentication: {
          location: 'query',
        },
      }),
    ).toEqual(
      [
        `curl 'https://yaak.app?foo=bar&baz=qux&token='`,
      ].join(` \\\n  `),
    );
  });

  test('Stale body data', async () => {
    expect(
      await convertToCurl({
        url: 'https://yaak.app',
        bodyType: 'none',
        body: {
          text: 'ignore me',
        },
      }),
    ).toEqual([`curl 'https://yaak.app'`].join(` \\\n  `));
  });
});
