import { describe, expect, test } from 'vitest';
import { convert } from '../src';

describe('exporter-curl', () => {
  test('Simple example', async () => {
    expect(
      await convert(
        {
          url: 'https://yaak.app',
        },
        [],
      ),
    ).toEqual([`grpcurl yaak.app`].join(` \\\n  `));
  });
  test('Basic metadata', async () => {
    expect(
      await convert(
        {
          url: 'https://yaak.app',
          metadata: [
            { name: 'aaa', value: 'AAA' },
            { enabled: true, name: 'bbb', value: 'BBB' },
            { enabled: false, name: 'disabled', value: 'ddd' },
          ],
        },
        [],
      ),
    ).toEqual([`grpcurl -H 'aaa: AAA'`, `-H 'bbb: BBB'`, `yaak.app`].join(` \\\n  `));
  });
  test('Single proto file', async () => {
    expect(await convert({ url: 'https://yaak.app' }, ['/foo/bar/baz.proto'])).toEqual(
      [
        `grpcurl -import-path '/foo/bar'`,
        `-import-path '/foo'`,
        `-proto '/foo/bar/baz.proto'`,
        `yaak.app`,
      ].join(` \\\n  `),
    );
  });
  test('Multiple proto files, same dir', async () => {
    expect(
      await convert({ url: 'https://yaak.app' }, ['/foo/bar/aaa.proto', '/foo/bar/bbb.proto']),
    ).toEqual(
      [
        `grpcurl -import-path '/foo/bar'`,
        `-import-path '/foo'`,
        `-proto '/foo/bar/aaa.proto'`,
        `-proto '/foo/bar/bbb.proto'`,
        `yaak.app`,
      ].join(` \\\n  `),
    );
  });
  test('Multiple proto files, different dir', async () => {
    expect(
      await convert({ url: 'https://yaak.app' }, ['/aaa/bbb/ccc.proto', '/xxx/yyy/zzz.proto']),
    ).toEqual(
      [
        `grpcurl -import-path '/aaa/bbb'`,
        `-import-path '/aaa'`,
        `-import-path '/xxx/yyy'`,
        `-import-path '/xxx'`,
        `-proto '/aaa/bbb/ccc.proto'`,
        `-proto '/xxx/yyy/zzz.proto'`,
        `yaak.app`,
      ].join(` \\\n  `),
    );
  });
  test('Single include dir', async () => {
    expect(await convert({ url: 'https://yaak.app' }, ['/aaa/bbb'])).toEqual(
      [`grpcurl -import-path '/aaa/bbb'`, `yaak.app`].join(` \\\n  `),
    );
  });
  test('Multiple include dir', async () => {
    expect(await convert({ url: 'https://yaak.app' }, ['/aaa/bbb', '/xxx/yyy'])).toEqual(
      [`grpcurl -import-path '/aaa/bbb'`, `-import-path '/xxx/yyy'`, `yaak.app`].join(` \\\n  `),
    );
  });
  test('Mixed proto and dirs', async () => {
    expect(
      await convert({ url: 'https://yaak.app' }, ['/aaa/bbb', '/xxx/yyy', '/foo/bar.proto']),
    ).toEqual(
      [
        `grpcurl -import-path '/aaa/bbb'`,
        `-import-path '/xxx/yyy'`,
        `-import-path '/foo'`,
        `-import-path '/'`,
        `-proto '/foo/bar.proto'`,
        `yaak.app`,
      ].join(` \\\n  `),
    );
  });
  test('Sends data', async () => {
    expect(
      await convert(
        {
          url: 'https://yaak.app',
          message: JSON.stringify({ foo: 'bar', baz: 1.0 }, null, 2),
        },
        ['/foo.proto'],
      ),
    ).toEqual(
      [
        `grpcurl -import-path '/'`,
        `-proto '/foo.proto'`,
        `-d '{"foo":"bar","baz":1}'`,
        `yaak.app`,
      ].join(` \\\n  `),
    );
  });
});
