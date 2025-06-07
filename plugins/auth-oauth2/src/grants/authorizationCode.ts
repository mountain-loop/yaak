import { Context } from '@yaakapp/api';
import { createHash, randomBytes } from 'node:crypto';
import { getAccessToken } from '../getAccessToken';
import { getOrRefreshAccessToken } from '../getOrRefreshAccessToken';
import { AccessToken, getDataDirKey, storeToken } from '../store';

export const PKCE_SHA256 = 'S256';
export const PKCE_PLAIN = 'plain';
export const DEFAULT_PKCE_METHOD = PKCE_SHA256;

export async function getAuthorizationCode(
  ctx: Context,
  contextId: string,
  {
    authorizationUrl: authorizationUrlRaw,
    accessTokenUrl,
    clientId,
    clientSecret,
    redirectUri,
    scope,
    state,
    audience,
    credentialsInBody,
    pkce,
    tokenName,
  }: {
    authorizationUrl: string;
    accessTokenUrl: string;
    clientId: string;
    clientSecret: string;
    redirectUri: string | null;
    scope: string | null;
    state: string | null;
    audience: string | null;
    credentialsInBody: boolean;
    pkce: {
      challengeMethod: string | null;
      codeVerifier: string | null;
    } | null;
    tokenName: 'access_token' | 'id_token';
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

  const authorizationUrl = new URL(`${authorizationUrlRaw ?? ''}`);
  authorizationUrl.searchParams.set('response_type', 'code');
  authorizationUrl.searchParams.set('client_id', clientId);
  if (redirectUri) authorizationUrl.searchParams.set('redirect_uri', redirectUri);
  if (scope) authorizationUrl.searchParams.set('scope', scope);
  if (state) authorizationUrl.searchParams.set('state', state);
  if (audience) authorizationUrl.searchParams.set('audience', audience);
  if (pkce) {
    const verifier = pkce.codeVerifier || createPkceCodeVerifier();
    const challengeMethod = pkce.challengeMethod || DEFAULT_PKCE_METHOD;
    authorizationUrl.searchParams.set(
      'code_challenge',
      createPkceCodeChallenge(verifier, challengeMethod),
    );
    authorizationUrl.searchParams.set('code_challenge_method', challengeMethod);
  }

  return new Promise(async (resolve, reject) => {
    const authorizationUrlStr = authorizationUrl.toString();
    const logsEnabled = (await ctx.store.get('enable_logs')) ?? false;
    console.log('[oauth2] Authorizing', authorizationUrlStr);

    let foundCode = false;

    let { close } = await ctx.window.openUrl({
      url: authorizationUrlStr,
      label: 'oauth-authorization-url',
      dataDirKey: await getDataDirKey(ctx, contextId),
      async onClose() {
        if (!foundCode) {
          reject(new Error('Authorization window closed'));
        }
      },
      async onNavigate({ url: urlStr }) {
        const url = new URL(urlStr);
        if (logsEnabled) console.log('[oauth2] Navigated to', urlStr);

        if (url.searchParams.has('error')) {
          return reject(new Error(`Failed to authorize: ${url.searchParams.get('error')}`));
        }

        const code = url.searchParams.get('code');
        if (!code) {
          console.log('[oauth2] Code not found');
          return; // Could be one of many redirects in a chain, so skip it
        }

        // Close the window here, because we don't need it anymore!
        foundCode = true;
        close();

        console.log('[oauth2] Code found');
        const response = await getAccessToken(ctx, {
          grantType: 'authorization_code',
          accessTokenUrl,
          clientId,
          clientSecret,
          scope,
          audience,
          credentialsInBody,
          params: [
            { name: 'code', value: code },
            ...(redirectUri ? [{ name: 'redirect_uri', value: redirectUri }] : []),
          ],
        });

        try {
          resolve(await storeToken(ctx, contextId, response, tokenName));
        } catch (err) {
          reject(err);
        }
      },
    });
  });
}

function createPkceCodeVerifier() {
  return encodeForPkce(randomBytes(32));
}

function createPkceCodeChallenge(verifier: string, method: string) {
  if (method === 'plain') {
    return verifier;
  }

  const hash = encodeForPkce(createHash('sha256').update(verifier).digest());
  return hash
    .replace(/=/g, '') // Remove padding '='
    .replace(/\+/g, '-') // Replace '+' with '-'
    .replace(/\//g, '_'); // Replace '/' with '_'
}

function encodeForPkce(bytes: Buffer) {
  return bytes
    .toString('base64')
    .replace(/=/g, '') // Remove padding '='
    .replace(/\+/g, '-') // Replace '+' with '-'
    .replace(/\//g, '_'); // Replace '/' with '_'
}
