import { Context, HttpRequest } from '@yaakapp/api';
import { readFileSync } from 'node:fs';
import { AccessToken, AccessTokenRawResponse, deleteToken, getToken, storeToken } from './store';

export async function getOrRefreshAccessToken(ctx: Context, contextId: string, {
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
}): Promise<AccessToken | null> {
  const token = await getToken(ctx, contextId);
  if (token == null) {
    return null;
  }

  const now = Date.now();
  const isExpired = token.expiresAt && now > token.expiresAt;

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

  if (scope) httpRequest.body!.form.push({ name: 'scope', value: scope });

  if (credentialsInBody) {
    httpRequest.body!.form.push({ name: 'client_id', value: clientId });
    httpRequest.body!.form.push({ name: 'client_secret', value: clientSecret });
  } else {
    const value = 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    httpRequest.headers!.push({ name: 'Authorization', value });
  }

  httpRequest.authenticationType = 'none'; // Don't inherit workspace auth
  const resp = await ctx.httpRequest.send({ httpRequest });

  if (resp.status === 401) {
    // Bad refresh token, so we'll force it to fetch a fresh access token by deleting
    // and returning null;
    console.log('[oauth2] Unauthorized refresh_token request');
    await deleteToken(ctx, contextId);
    return null;
  }

  const body = resp.bodyPath ? readFileSync(resp.bodyPath, 'utf8') : '';

  console.log('[oauth2] Got refresh token response', resp.status);

  if (resp.status < 200 || resp.status >= 300) {
    throw new Error('Failed to refresh access token with status=' + resp.status + ' and body=' + body);
  }

  let response;
  try {
    response = JSON.parse(body);
  } catch {
    response = Object.fromEntries(new URLSearchParams(body));
  }

  if (response.error) {
    throw new Error(`Failed to fetch access token with ${response.error} -> ${response.error_description}`);
  }

  const newResponse: AccessTokenRawResponse = {
    ...response,
    // Assign a new one or keep the old one,
    refresh_token: response.refresh_token ?? token.response.refresh_token,
  };

  return storeToken(ctx, contextId, newResponse);
}
