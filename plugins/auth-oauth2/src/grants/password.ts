import { Context } from '@yaakapp/api';
import { getAccessToken } from '../getAccessToken';
import { getOrRefreshAccessToken } from '../getOrRefreshAccessToken';
import { AccessToken, storeToken } from '../store';

export async function getPassword(
  ctx: Context,
  contextId: string,
  {
    accessTokenUrl,
    clientId,
    clientSecret,
    username,
    password,
    credentialsInBody,
    audience,
    scope,
  }: {
    accessTokenUrl: string;
    clientId: string;
    clientSecret: string;
    username: string;
    password: string;
    scope: string | null;
    audience: string | null;
    credentialsInBody: boolean;
  },
): Promise<AccessToken> {
  const token = await getOrRefreshAccessToken(ctx, contextId, {
    accessTokenUrl,
    scope,
    clientId,
    clientSecret,
    credentialsInBody,
  });
  if (token != null) {
    return token;
  }

  const response = await getAccessToken(ctx, {
    accessTokenUrl,
    clientId,
    clientSecret,
    scope,
    audience,
    grantType: 'password',
    credentialsInBody,
    params: [
      { name: 'username', value: username },
      { name: 'password', value: password },
    ],
  });

  return storeToken(ctx, contextId, response);
}
