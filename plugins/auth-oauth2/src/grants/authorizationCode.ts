import type { Context } from '@yaakapp/api';
import { createHash, randomBytes } from 'node:crypto';
import { fetchAccessToken } from '../fetchAccessToken';
import { getOrRefreshAccessToken } from '../getOrRefreshAccessToken';
import type { AccessToken, TokenStoreArgs } from '../store';
import { getDataDirKey, storeToken } from '../store';
import { extractCode } from '../util';

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
      challengeMethod: string;
      codeVerifier: string;
    } | null;
    tokenName: 'access_token' | 'id_token';
  },
): Promise<AccessToken> {
  const tokenArgs: TokenStoreArgs = {
    contextId,
    clientId,
    accessTokenUrl,
    authorizationUrl: authorizationUrlRaw,
  };

  const token = await getOrRefreshAccessToken(ctx, tokenArgs, {
    accessTokenUrl,
    scope,
    clientId,
    clientSecret,
    credentialsInBody,
  });
  if (token != null) {
    return token;
  }

  let authorizationUrl: URL;
  try {
    authorizationUrl = new URL(`${authorizationUrlRaw ?? ''}`);
  } catch {
    throw new Error(`Invalid authorization URL "${authorizationUrlRaw}"`);
  }
  authorizationUrl.searchParams.set('response_type', 'code');
  authorizationUrl.searchParams.set('client_id', clientId);
  if (redirectUri) authorizationUrl.searchParams.set('redirect_uri', redirectUri);
  if (scope) authorizationUrl.searchParams.set('scope', scope);
  if (state) authorizationUrl.searchParams.set('state', state);
  if (audience) authorizationUrl.searchParams.set('audience', audience);
  if (pkce) {
    authorizationUrl.searchParams.set(
      'code_challenge',
      pkceCodeChallenge(pkce.codeVerifier, pkce.challengeMethod),
    );
    authorizationUrl.searchParams.set('code_challenge_method', pkce.challengeMethod);
  }

  const dataDirKey = await getDataDirKey(ctx, contextId);
  const authorizationUrlStr = authorizationUrl.toString();
  console.log('[oauth2] Authorizing', authorizationUrlStr);

  // eslint-disable-next-line no-async-promise-executor
  const code = await new Promise<string>(async (resolve, reject) => {
    let foundCode = false;
    const { close } = await ctx.window.openUrl({
      dataDirKey,
      url: authorizationUrlStr,
      label: 'oauth-authorization-url',
      async onClose() {
        if (!foundCode) {
          reject(new Error('Authorization window closed'));
        }
      },
      async onNavigate({ url: urlStr }) {
        let code;
        try {
          code = extractCode(urlStr, redirectUri);
        } catch (err) {
          reject(err);
          close();
          return;
        }

        if (!code) {
          return;
        }

        // Close the window here, because we don't need it anymore!
        foundCode = true;
        close();
        resolve(code);
      },
    });
  });

  console.log('[oauth2] Code found');
  const response = await fetchAccessToken(ctx, {
    grantType: 'authorization_code',
    accessTokenUrl,
    clientId,
    clientSecret,
    scope,
    audience,
    credentialsInBody,
    params: [
      { name: 'code', value: code },
      ...(pkce ? [{ name: 'code_verifier', value: pkce.codeVerifier }] : []),
      ...(redirectUri ? [{ name: 'redirect_uri', value: redirectUri }] : []),
    ],
  });

  return storeToken(ctx, tokenArgs, response, tokenName);
}

export function genPkceCodeVerifier() {
  return encodeForPkce(randomBytes(32));
}

function pkceCodeChallenge(verifier: string, method: string) {
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
