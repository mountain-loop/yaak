import { Context } from '@yaakapp/api';
import { getAccessToken } from '../getAccessToken';
import { getToken, storeToken } from '../store';

export async function getClientCredentials(
  ctx: Context,
  contextId: string,
  {
    accessTokenUrl,
    clientId,
    clientSecret,
    scope,
    audience,
    credentialsInBody,
  }: {
    accessTokenUrl: string;
    clientId: string;
    clientSecret: string;
    scope: string | null;
    audience: string | null;
    credentialsInBody: boolean;
  },
) {
  const token = await getToken(ctx, contextId);
  if (token) {
    // resolve(token.response.access_token);
    // TODO: Refresh token if expired
    // return;
  }

  const response = await getAccessToken(ctx, {
    grantType: 'client_credentials',
    accessTokenUrl,
    audience,
    clientId,
    clientSecret,
    scope,
    credentialsInBody,
    params: [],
  });

  return storeToken(ctx, contextId, response);
}
