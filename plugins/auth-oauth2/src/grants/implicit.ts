import type { Context } from '@yaakapp/api';
import { getRedirectUrlViaExternalBrowser } from '../callbackServer';
import type { AccessToken, AccessTokenRawResponse } from '../store';
import { getDataDirKey, getToken, storeToken } from '../store';
import { isTokenExpired } from '../util';
import type { ExternalBrowserOptions } from './authorizationCode';

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
    externalBrowser,
  }: {
    authorizationUrl: string;
    responseType: string;
    clientId: string;
    redirectUri: string | null;
    scope: string | null;
    state: string | null;
    audience: string | null;
    tokenName: 'access_token' | 'id_token';
    externalBrowser?: ExternalBrowserOptions;
  },
): Promise<AccessToken> {
  const tokenArgs = {
    contextId,
    clientId,
    accessTokenUrl: null,
    authorizationUrl: authorizationUrlRaw,
  };
  const token = await getToken(ctx, tokenArgs);
  if (token != null && !isTokenExpired(token)) {
    return token;
  }

  let authorizationUrl: URL;
  try {
    authorizationUrl = new URL(`${authorizationUrlRaw ?? ''}`);
  } catch {
    throw new Error(`Invalid authorization URL "${authorizationUrlRaw}"`);
  }
  authorizationUrl.searchParams.set('response_type', responseType);
  authorizationUrl.searchParams.set('client_id', clientId);
  if (scope) authorizationUrl.searchParams.set('scope', scope);
  if (state) authorizationUrl.searchParams.set('state', state);
  if (audience) authorizationUrl.searchParams.set('audience', audience);
  if (responseType.includes('id_token')) {
    authorizationUrl.searchParams.set(
      'nonce',
      String(Math.floor(Math.random() * 9999999999999) + 1),
    );
  }

  let newToken: AccessToken;

  // Use external browser flow if enabled
  if (externalBrowser?.useExternalBrowser) {
    const result = await getRedirectUrlViaExternalBrowser(ctx, authorizationUrl, {
      callbackType: externalBrowser.callbackType,
      callbackPort: externalBrowser.callbackPort,
    });
    newToken = await extractImplicitToken(ctx, result.callbackUrl, tokenArgs, tokenName);
  } else {
    // Use embedded browser flow (original behavior)
    if (redirectUri) {
      authorizationUrl.searchParams.set('redirect_uri', redirectUri);
    }
    newToken = await getTokenViaEmbeddedBrowser(
      ctx,
      contextId,
      authorizationUrl,
      tokenArgs,
      tokenName,
    );
  }

  return newToken;
}

/**
 * Get token using the embedded browser window.
 * This is the original flow that monitors navigation events.
 */
async function getTokenViaEmbeddedBrowser(
  ctx: Context,
  contextId: string,
  authorizationUrl: URL,
  tokenArgs: {
    contextId: string;
    clientId: string;
    accessTokenUrl: null;
    authorizationUrl: string;
  },
  tokenName: 'access_token' | 'id_token',
): Promise<AccessToken> {
  const dataDirKey = await getDataDirKey(ctx, contextId);
  const authorizationUrlStr = authorizationUrl.toString();
  console.log('[oauth2] Authorizing via embedded browser (implicit)', authorizationUrlStr);

  // biome-ignore lint/suspicious/noAsyncPromiseExecutor: Required for this pattern
  return new Promise<AccessToken>(async (resolve, reject) => {
    let foundAccessToken = false;
    const { close } = await ctx.window.openUrl({
      dataDirKey,
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
          resolve(storeToken(ctx, tokenArgs, response));
        } catch (err) {
          reject(err);
        }
      },
    });
  });
}

/**
 * Extract the implicit grant token from a callback URL and store it.
 */
async function extractImplicitToken(
  ctx: Context,
  callbackUrl: string,
  tokenArgs: {
    contextId: string;
    clientId: string;
    accessTokenUrl: null;
    authorizationUrl: string;
  },
  tokenName: 'access_token' | 'id_token',
): Promise<AccessToken> {
  const url = new URL(callbackUrl);

  // Check for errors
  if (url.searchParams.has('error')) {
    throw new Error(`Failed to authorize: ${url.searchParams.get('error')}`);
  }

  // Extract token from fragment
  const hash = url.hash.slice(1);
  const params = new URLSearchParams(hash);

  // Also check query params (in case fragment was converted)
  const accessToken = params.get(tokenName) ?? url.searchParams.get(tokenName);
  if (!accessToken) {
    throw new Error(`No ${tokenName} found in callback URL`);
  }

  // Build response from params (prefer fragment, fall back to query)
  const response: AccessTokenRawResponse = {
    access_token: params.get('access_token') ?? url.searchParams.get('access_token') ?? '',
    token_type: params.get('token_type') ?? url.searchParams.get('token_type') ?? undefined,
    expires_in: params.has('expires_in')
      ? parseInt(params.get('expires_in') ?? '0', 10)
      : url.searchParams.has('expires_in')
        ? parseInt(url.searchParams.get('expires_in') ?? '0', 10)
        : undefined,
    scope: params.get('scope') ?? url.searchParams.get('scope') ?? undefined,
  };

  // Include id_token if present
  const idToken = params.get('id_token') ?? url.searchParams.get('id_token');
  if (idToken) {
    response.id_token = idToken;
  }

  return storeToken(ctx, tokenArgs, response);
}
