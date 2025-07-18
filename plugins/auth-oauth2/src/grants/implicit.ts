import type { Context } from '@yaakapp/api';
import { isTokenExpired } from '../getAccessTokenIfNotExpired';
import type { AccessToken, AccessTokenRawResponse} from '../store';
import { getToken, storeToken } from '../store';

export async function getImplicit(
  ctx: Context,
  contextId: string,
  {
    authorizationUrl: authorizationUrlRaw,
    responseType,
    clientId,
    redirectUri,
    scope,
    state,
    audience,
    tokenName,
  }: {
    authorizationUrl: string;
    responseType: string;
    clientId: string;
    redirectUri: string | null;
    scope: string | null;
    state: string | null;
    audience: string | null;
    tokenName: 'access_token' | 'id_token';
  },
): Promise<AccessToken> {
  const token = await getToken(ctx, contextId);
  if (token != null && !isTokenExpired(token)) {
    return token;
  }

  let authorizationUrl: URL;
  try {
    authorizationUrl = new URL(`${authorizationUrlRaw ?? ''}`);
  } catch {
    throw new Error(`Invalid authorization URL "${authorizationUrlRaw}"`);
  }
  authorizationUrl.searchParams.set('response_type', 'token');
  authorizationUrl.searchParams.set('client_id', clientId);
  if (redirectUri) authorizationUrl.searchParams.set('redirect_uri', redirectUri);
  if (scope) authorizationUrl.searchParams.set('scope', scope);
  if (state) authorizationUrl.searchParams.set('state', state);
  if (audience) authorizationUrl.searchParams.set('audience', audience);
  if (responseType.includes('id_token')) {
    authorizationUrl.searchParams.set(
      'nonce',
      String(Math.floor(Math.random() * 9999999999999) + 1),
    );
  }

  // eslint-disable-next-line no-async-promise-executor
  const newToken = await new Promise<AccessToken>(async (resolve, reject) => {
    let foundAccessToken = false;
    const authorizationUrlStr = authorizationUrl.toString();
    const { close } = await ctx.window.openUrl({
      url: authorizationUrlStr,
      label: 'oauth-authorization-url',
      async onClose() {
        if (!foundAccessToken) {
          reject(new Error('Authorization window closed'));
        }
      },
      async onNavigate({ url: urlStr }) {
        const url = new URL(urlStr);
        if (url.searchParams.has('error')) {
          return reject(Error(`Failed to authorize: ${url.searchParams.get('error')}`));
        }

        const hash = url.hash.slice(1);
        const params = new URLSearchParams(hash);

        const accessToken = params.get(tokenName);
        if (!accessToken) {
          return;
        }
        foundAccessToken = true;

        // Close the window here, because we don't need it anymore
        close();

        const response = Object.fromEntries(params) as unknown as AccessTokenRawResponse;
        try {
          resolve(storeToken(ctx, contextId, response));
        } catch (err) {
          reject(err);
        }
      },
    });
  });

  return newToken;
}
