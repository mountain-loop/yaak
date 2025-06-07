import { HttpRequest, Workspace } from '@yaakapp/api';
import { describe, expect, test } from 'vitest';
import { convertCurl } from '../src';

describe('importer-curl', () => {
  test('Imports basic GET', () => {
    expect(convertCurl('curl https://yaak.app')).toEqual({
      resources: {
        workspaces: [baseWorkspace()],
        httpRequests: [
          baseRequest({
            url: 'https://yaak.app',
          }),
        ],
      },
    });
  });

  test('Explicit URL', () => {
    expect(convertCurl('curl --url https://yaak.app')).toEqual({
      resources: {
        workspaces: [baseWorkspace()],
        httpRequests: [
          baseRequest({
            url: 'https://yaak.app',
          }),
        ],
      },
    });
  });

  test('Missing URL', () => {
    expect(convertCurl('curl -X POST')).toEqual({
      resources: {
        workspaces: [baseWorkspace()],
        httpRequests: [
          baseRequest({
            method: 'POST',
          }),
        ],
      },
    });
  });

  test('URL between', () => {
    expect(convertCurl('curl -v https://yaak.app -X POST')).toEqual({
      resources: {
        workspaces: [baseWorkspace()],
        httpRequests: [
          baseRequest({
            url: 'https://yaak.app',
            method: 'POST',
          }),
        ],
      },
    });
  });

  test('Random flags', () => {
    expect(convertCurl('curl --random -Z -Y -S --foo https://yaak.app')).toEqual({
      resources: {
        workspaces: [baseWorkspace()],
        httpRequests: [
          baseRequest({
            url: 'https://yaak.app',
          }),
        ],
      },
    });
  });

  test('Imports --request method', () => {
    expect(convertCurl('curl --request POST https://yaak.app')).toEqual({
      resources: {
        workspaces: [baseWorkspace()],
        httpRequests: [
          baseRequest({
            url: 'https://yaak.app',
            method: 'POST',
          }),
        ],
      },
    });
  });

  test('Imports -XPOST method', () => {
    expect(convertCurl('curl -XPOST --request POST https://yaak.app')).toEqual({
      resources: {
        workspaces: [baseWorkspace()],
        httpRequests: [
          baseRequest({
            url: 'https://yaak.app',
            method: 'POST',
          }),
        ],
      },
    });
  });

  test('Imports multiple requests', () => {
    expect(
      convertCurl('curl \\\n  https://yaak.app\necho "foo"\ncurl example.com;curl foo.com'),
    ).toEqual({
      resources: {
        workspaces: [baseWorkspace()],
        httpRequests: [
          baseRequest({ url: 'https://yaak.app' }),
          baseRequest({ url: 'example.com' }),
          baseRequest({ url: 'foo.com' }),
        ],
      },
    });
  });

  test('Imports form data', () => {
    expect(
      convertCurl('curl -X POST -F "a=aaa" -F b=bbb" -F f=@filepath https://yaak.app'),
    ).toEqual({
      resources: {
        workspaces: [baseWorkspace()],
        httpRequests: [
          baseRequest({
            method: 'POST',
            url: 'https://yaak.app',
            headers: [
              {
                name: 'Content-Type',
                value: 'multipart/form-data',
                enabled: true,
              },
            ],
            bodyType: 'multipart/form-data',
            body: {
              form: [
                { enabled: true, name: 'a', value: 'aaa' },
                { enabled: true, name: 'b', value: 'bbb' },
                { enabled: true, name: 'f', file: 'filepath' },
              ],
            },
          }),
        ],
      },
    });
  });

  test('Imports data params as form url-encoded', () => {
    expect(convertCurl('curl -d a -d b -d c=ccc https://yaak.app')).toEqual({
      resources: {
        workspaces: [baseWorkspace()],
        httpRequests: [
          baseRequest({
            method: 'POST',
            url: 'https://yaak.app',
            bodyType: 'application/x-www-form-urlencoded',
            headers: [
              {
                name: 'Content-Type',
                value: 'application/x-www-form-urlencoded',
                enabled: true,
              },
            ],
            body: {
              form: [
                { name: 'a', value: '', enabled: true },
                { name: 'b', value: '', enabled: true },
                { name: 'c', value: 'ccc', enabled: true },
              ],
            },
          }),
        ],
      },
    });
  });

  test('Imports combined data params as form url-encoded', () => {
    expect(convertCurl(`curl -d 'a=aaa&b=bbb&c' https://yaak.app`)).toEqual({
      resources: {
        workspaces: [baseWorkspace()],
        httpRequests: [
          baseRequest({
            method: 'POST',
            url: 'https://yaak.app',
            bodyType: 'application/x-www-form-urlencoded',
            headers: [
              {
                name: 'Content-Type',
                value: 'application/x-www-form-urlencoded',
                enabled: true,
              },
            ],
            body: {
              form: [
                { name: 'a', value: 'aaa', enabled: true },
                { name: 'b', value: 'bbb', enabled: true },
                { name: 'c', value: '', enabled: true },
              ],
            },
          }),
        ],
      },
    });
  });

  test('Imports data params as text', () => {
    expect(
      convertCurl('curl -H Content-Type:text/plain -d a -d b -d c=ccc https://yaak.app'),
    ).toEqual({
      resources: {
        workspaces: [baseWorkspace()],
        httpRequests: [
          baseRequest({
            method: 'POST',
            url: 'https://yaak.app',
            headers: [{ name: 'Content-Type', value: 'text/plain', enabled: true }],
            bodyType: 'text/plain',
            body: { text: 'a&b&c=ccc' },
          }),
        ],
      },
    });
  });

  test('Imports post data into URL', () => {
    expect(
      convertCurl('curl -G https://api.stripe.com/v1/payment_links -d limit=3'),
    ).toEqual({
      resources: {
        workspaces: [baseWorkspace()],
        httpRequests: [
          baseRequest({
            method: 'GET',
            url: 'https://api.stripe.com/v1/payment_links',
            urlParameters: [{
              enabled: true,
              name: 'limit',
              value: '3',
            }],
          }),
        ],
      },
    });
  });

  test('Imports multi-line JSON', () => {
    expect(
      convertCurl(`curl -H Content-Type:application/json -d $'{\n  "foo":"bar"\n}' https://yaak.app`),
    ).toEqual({
      resources: {
        workspaces: [baseWorkspace()],
        httpRequests: [
          baseRequest({
            method: 'POST',
            url: 'https://yaak.app',
            headers: [{ name: 'Content-Type', value: 'application/json', enabled: true }],
            bodyType: 'application/json',
            body: { text: '{\n  "foo":"bar"\n}' },
          }),
        ],
      },
    });
  });

  test('Imports multiple headers', () => {
    expect(
      convertCurl('curl -H Foo:bar --header Name -H AAA:bbb -H :ccc https://yaak.app'),
    ).toEqual({
      resources: {
        workspaces: [baseWorkspace()],
        httpRequests: [
          baseRequest({
            url: 'https://yaak.app',
            headers: [
              { name: 'Name', value: '', enabled: true },
              { name: 'Foo', value: 'bar', enabled: true },
              { name: 'AAA', value: 'bbb', enabled: true },
              { name: '', value: 'ccc', enabled: true },
            ],
          }),
        ],
      },
    });
  });

  test('Imports basic auth', () => {
    expect(convertCurl('curl --user user:pass https://yaak.app')).toEqual({
      resources: {
        workspaces: [baseWorkspace()],
        httpRequests: [
          baseRequest({
            url: 'https://yaak.app',
            authenticationType: 'basic',
            authentication: {
              username: 'user',
              password: 'pass',
            },
          }),
        ],
      },
    });
  });

  test('Imports digest auth', () => {
    expect(convertCurl('curl --digest --user user:pass https://yaak.app')).toEqual({
      resources: {
        workspaces: [baseWorkspace()],
        httpRequests: [
          baseRequest({
            url: 'https://yaak.app',
            authenticationType: 'digest',
            authentication: {
              username: 'user',
              password: 'pass',
            },
          }),
        ],
      },
    });
  });

  test('Imports cookie as header', () => {
    expect(convertCurl('curl --cookie "foo=bar" https://yaak.app')).toEqual({
      resources: {
        workspaces: [baseWorkspace()],
        httpRequests: [
          baseRequest({
            url: 'https://yaak.app',
            headers: [{ name: 'Cookie', value: 'foo=bar', enabled: true }],
          }),
        ],
      },
    });
  });

  test('Imports query params', () => {
    expect(convertCurl('curl "https://yaak.app" --url-query foo=bar --url-query baz=qux')).toEqual({
      resources: {
        workspaces: [baseWorkspace()],
        httpRequests: [
          baseRequest({
            url: 'https://yaak.app',
            urlParameters: [
              { name: 'foo', value: 'bar', enabled: true },
              { name: 'baz', value: 'qux', enabled: true },
            ],
          }),
        ],
      },
    });
  });

  test('Imports query params from the URL', () => {
    expect(convertCurl('curl "https://yaak.app?foo=bar&baz=a%20a"')).toEqual({
      resources: {
        workspaces: [baseWorkspace()],
        httpRequests: [
          baseRequest({
            url: 'https://yaak.app',
            urlParameters: [
              { name: 'foo', value: 'bar', enabled: true },
              { name: 'baz', value: 'a a', enabled: true },
            ],
          }),
        ],
      },
    });
  });
});

const idCount: Partial<Record<string, number>> = {};

function baseRequest(mergeWith: Partial<HttpRequest>) {
  idCount.http_request = (idCount.http_request ?? -1) + 1;
  return {
    id: `GENERATE_ID::HTTP_REQUEST_${idCount.http_request}`,
    model: 'http_request',
    authentication: {},
    authenticationType: null,
    body: {},
    bodyType: null,
    folderId: null,
    headers: [],
    method: 'GET',
    name: '',
    sortPriority: 0,
    url: '',
    urlParameters: [],
    workspaceId: `GENERATE_ID::WORKSPACE_${idCount.workspace}`,
    ...mergeWith,
  };
}

function baseWorkspace(mergeWith: Partial<Workspace> = {}) {
  idCount.workspace = (idCount.workspace ?? -1) + 1;
  return {
    id: `GENERATE_ID::WORKSPACE_${idCount.workspace}`,
    model: 'workspace',
    name: 'Curl Import',
    ...mergeWith,
  };
}
