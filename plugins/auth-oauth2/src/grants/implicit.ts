import type { Context } from '@yaakapp/api';
import { buildHostedCallbackRedirectUri, startCallbackServer } from '../callbackServer';
import type { AccessToken, AccessTokenRawResponse } from '../store';
import { getDataDirKey, getToken, storeToken } from '../store';
import { isTokenExpired } from '../util';
import { DEFAULT_LOCALHOST_PORT, type CallbackType, type ExternalBrowserOptions } from './authorizationCode';

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
    newToken = await getTokenViaExternalBrowser(ctx, authorizationUrl, tokenArgs, {
      callbackType: externalBrowser.callbackType,
      callbackPort: externalBrowser.callbackPort,
      redirectUri,
      tokenName,
    });
  } else {
    // Use embedded browser flow (original behavior)
    if (redirectUri) {
      authorizationUrl.searchParams.set('redirect_uri', redirectUri);
    }
    newToken = await getTokenViaEmbeddedBrowser(ctx, contextId, authorizationUrl, tokenArgs, tokenName);
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
  tokenArgs: { contextId: string; clientId: string; accessTokenUrl: null; authorizationUrl: string },
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
 * Get token using the system's default browser.
 * Starts a local HTTP server to receive the callback with token in fragment.
 */
async function getTokenViaExternalBrowser(
  ctx: Context,
  authorizationUrl: URL,
  tokenArgs: { contextId: string; clientId: string; accessTokenUrl: null; authorizationUrl: string },
  options: {
    callbackType: CallbackType;
    callbackPort?: number;
    redirectUri: string | null;
    tokenName: 'access_token' | 'id_token';
  },
): Promise<AccessToken> {
  const { callbackType, callbackPort, redirectUri, tokenName } = options;

  // Determine port based on callback type:
  // - localhost: use specified port or default stable port
  // - hosted: use random port (0) since hosted page redirects to local
  const port = callbackType === 'localhost'
    ? (callbackPort ?? DEFAULT_LOCALHOST_PORT)
    : 0; // Random port for hosted callback

  console.log(`[oauth2] Starting callback server for implicit flow (type: ${callbackType}, port: ${port || 'random'})`);

  // Start the local callback server
  const server = await startCallbackServer({
    port,
    path: '/callback',
  });

  try {
    // Determine the redirect URI to send to the OAuth provider
    let oauthRedirectUri: string;

    if (callbackType === 'hosted') {
      // For hosted callback, the OAuth provider redirects to the hosted page,
      // which then redirects to our local server (preserving the fragment)
      oauthRedirectUri = buildHostedCallbackRedirectUri(server.port, '/callback');
      console.log('[oauth2] Using hosted callback redirect:', oauthRedirectUri);
    } else {
      // For localhost callback, use the local server directly
      oauthRedirectUri = redirectUri ?? server.redirectUri;
      console.log('[oauth2] Using localhost callback redirect:', oauthRedirectUri);
    }

    // Set the redirect URI on the authorization URL
    authorizationUrl.searchParams.set('redirect_uri', oauthRedirectUri);

    const authorizationUrlStr = authorizationUrl.toString();
    console.log('[oauth2] Opening external browser (implicit):', authorizationUrlStr);

    // Show toast to inform user
    await ctx.toast.show({
      message: 'Opening browser for authorization...',
      icon: 'info',
      timeout: 3000,
    });

    // Open the system browser
    await ctx.window.openExternalUrl(authorizationUrlStr);

    // Wait for the callback
    // Note: For implicit flow, the token is in the URL fragment (#access_token=...)
    // The hosted callback page will need to preserve this and pass it to the local server
    console.log('[oauth2] Waiting for callback on', server.redirectUri);
    const callbackUrl = await server.waitForCallback();

    console.log('[oauth2] Received callback:', callbackUrl);

    // Parse the callback URL
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
  } catch (err) {
    // Ensure server is stopped on error
    server.stop();
    throw err;
  }
}
