import { readFileSync } from 'node:fs';
import type { Context, HttpRequest } from '@yaakapp/api';
import type { AccessToken, AccessTokenRawResponse, TokenStoreArgs } from './store';
import { deleteToken, getToken, storeToken } from './store';
import { isTokenExpired } from './util';

export async function getOrRefreshAccessToken(
  ctx: Context,
  tokenArgs: TokenStoreArgs,
  {
    scope,
    accessTokenUrl,
    credentialsInBody,
    clientId,
    clientSecret,
    forceRefresh,
  }: {
    scope: string | null;
    accessTokenUrl: string;
    credentialsInBody: boolean;
    clientId: string;
    clientSecret: string;
    forceRefresh?: boolean;
  },
): Promise<AccessToken | null> {
  const token = await getToken(ctx, tokenArgs);
  if (token == null) {
    return null;
  }

  const isExpired = isTokenExpired(token);

  // Return the current access token if it's still valid
  if (!isExpired && !forceRefresh) {
    return token;
  }

  // Token is expired, but there's no refresh token :(
  if (!token.response.refresh_token) {
    return null;
  }

  // Access token is expired, so get a new one
  const httpRequest: Partial<HttpRequest> = {
    method: 'POST',
    url: accessTokenUrl,
    bodyType: 'application/x-www-form-urlencoded',
    body: {
      form: [
        { name: 'grant_type', value: 'refresh_token' },
        { name: 'refresh_token', value: token.response.refresh_token },
      ],
    },
    headers: [
      { name: 'User-Agent', value: 'yaak' },
      { name: 'Accept', value: 'application/x-www-form-urlencoded, application/json' },
      { name: 'Content-Type', value: 'application/x-www-form-urlencoded' },
    ],
  };

  if (scope) httpRequest.body?.form.push({ name: 'scope', value: scope });

  if (credentialsInBody) {
    httpRequest.body?.form.push({ name: 'client_id', value: clientId });
    httpRequest.body?.form.push({ name: 'client_secret', value: clientSecret });
  } else {
    const value = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
    httpRequest.headers?.push({ name: 'Authorization', value });
  }

  httpRequest.authenticationType = 'none'; // Don't inherit workspace auth
  const resp = await ctx.httpRequest.send({ httpRequest });

  if (resp.status >= 400 && resp.status < 500) {
    // Client errors (4xx) indicate the refresh token is invalid, expired, or revoked
    // Delete the token and return null to trigger a fresh authorization flow
    console.log('[oauth2] Refresh token request failed with client error, deleting token');
    await deleteToken(ctx, tokenArgs);
    return null;
  }

  const body = resp.bodyPath ? readFileSync(resp.bodyPath, 'utf8') : '';

  console.log('[oauth2] Got refresh token response', resp.status);

  if (resp.status < 200 || resp.status >= 300) {
    throw new Error(`Failed to refresh access token with status=${resp.status} and body=${body}`);
  }

  // biome-ignore lint/suspicious/noExplicitAny: none
  let response: any;
  try {
    response = JSON.parse(body);
  } catch {
    response = Object.fromEntries(new URLSearchParams(body));
  }

  if (response.error) {
    throw new Error(
      `Failed to fetch access token with ${response.error} -> ${response.error_description}`,
    );
  }

  const newResponse: AccessTokenRawResponse = {
    ...response,
    // Assign a new one or keep the old one,
    refresh_token: response.refresh_token ?? token.response.refresh_token,
  };

  return storeToken(ctx, tokenArgs, newResponse);
}
