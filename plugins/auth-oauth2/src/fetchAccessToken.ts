import { readFileSync } from 'node:fs';
import type { Context, HttpRequest, HttpUrlParameter } from '@yaakapp/api';
import type { AccessTokenRawResponse } from './store';

export async function fetchAccessToken(
  ctx: Context,
  args: {
    clientId: string;
    grantType: string;
    accessTokenUrl: string;
    scope: string | null;
    audience: string | null;
    params: HttpUrlParameter[];
  } & ({ clientAssertion: string } | { clientSecret: string; credentialsInBody: boolean }),
): Promise<AccessTokenRawResponse> {
  const { clientId, grantType, accessTokenUrl, scope, audience, params } = args;
  console.log('[oauth2] Getting access token', accessTokenUrl);
  const httpRequest: Partial<HttpRequest> = {
    method: 'POST',
    url: accessTokenUrl,
    bodyType: 'application/x-www-form-urlencoded',
    body: {
      form: [{ name: 'grant_type', value: grantType }, ...params],
    },
    headers: [
      { name: 'User-Agent', value: 'yaak' },
      {
        name: 'Accept',
        value: 'application/x-www-form-urlencoded, application/json',
      },
      { name: 'Content-Type', value: 'application/x-www-form-urlencoded' },
    ],
  };

  if (scope) httpRequest.body?.form.push({ name: 'scope', value: scope });
  if (audience) httpRequest.body?.form.push({ name: 'audience', value: audience });

  if ('clientAssertion' in args) {
    httpRequest.body?.form.push({ name: 'client_id', value: clientId });
    httpRequest.body?.form.push({
      name: 'client_assertion_type',
      value: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
    });
    httpRequest.body?.form.push({
      name: 'client_assertion',
      value: args.clientAssertion,
    });
  } else if (args.credentialsInBody) {
    httpRequest.body?.form.push({ name: 'client_id', value: clientId });
    httpRequest.body?.form.push({
      name: 'client_secret',
      value: args.clientSecret,
    });
  } else {
    const value = `Basic ${Buffer.from(`${clientId}:${args.clientSecret}`).toString('base64')}`;
    httpRequest.headers?.push({ name: 'Authorization', value });
  }

  httpRequest.authenticationType = 'none'; // Don't inherit workspace auth
  const resp = await ctx.httpRequest.send({ httpRequest });

  console.log('[oauth2] Got access token response', resp.status);

  if (resp.error) {
    throw new Error(`Failed to fetch access token: ${resp.error}`);
  }

  const body = resp.bodyPath ? readFileSync(resp.bodyPath, 'utf8') : '';

  if (resp.status < 200 || resp.status >= 300) {
    throw new Error(`Failed to fetch access token with status=${resp.status} and body=${body}`);
  }

  // biome-ignore lint/suspicious/noExplicitAny: none
  let response: any;
  try {
    response = JSON.parse(body);
  } catch {
    response = Object.fromEntries(new URLSearchParams(body));
  }

  if (response.error) {
    throw new Error(`Failed to fetch access token with ${response.error}`);
  }

  return response;
}
