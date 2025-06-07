import { Context } from '@yaakapp/api';
import { AccessToken, AccessTokenRawResponse, getToken, storeToken } from '../store';

export function getImplicit(
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
  return new Promise(async (resolve, reject) => {
    const token = await getToken(ctx, contextId);
    if (token) {
      // resolve(token.response.access_token);
      // TODO: Refresh token if expired
      // return;
    }

    const authorizationUrl = new URL(`${authorizationUrlRaw ?? ''}`);
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

    const authorizationUrlStr = authorizationUrl.toString();
    let foundAccessToken = false;
    let { close } = await ctx.window.openUrl({
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
          resolve(await storeToken(ctx, contextId, response));
        } catch (err) {
          reject(err);
        }
      },
    });
  });
}
