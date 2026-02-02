import type { IncomingMessage, ServerResponse } from 'node:http';
import http from 'node:http';
import type { Context } from '@yaakapp/api';

export const HOSTED_CALLBACK_URL = 'https://oauth.yaak.app/redirect';
export const DEFAULT_LOCALHOST_PORT = 8765;
const CALLBACK_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

/** Singleton: only one callback server runs at a time across all OAuth flows. */
let activeServer: CallbackServerResult | null = null;

export interface CallbackServerResult {
  /** The port the server is listening on */
  port: number;
  /** The full redirect URI to register with the OAuth provider */
  redirectUri: string;
  /** Promise that resolves with the callback URL when received */
  waitForCallback: () => Promise<string>;
  /** Stop the server */
  stop: () => void;
}

/**
 * Start a local HTTP server to receive OAuth callbacks.
 * Only one server runs at a time — if a previous server is still active,
 * it is stopped before starting the new one.
 * Returns the port, redirect URI, and a promise that resolves when the callback is received.
 */
export function startCallbackServer(options: {
  /** Specific port to use, or 0 for random available port */
  port?: number;
  /** Path for the callback endpoint */
  path?: string;
  /** Timeout in milliseconds (default 5 minutes) */
  timeoutMs?: number;
}): Promise<CallbackServerResult> {
  // Stop any previously active server before starting a new one
  if (activeServer) {
    console.log('[oauth2] Stopping previous callback server before starting new one');
    activeServer.stop();
    activeServer = null;
  }

  const { port = 0, path = '/callback', timeoutMs = CALLBACK_TIMEOUT_MS } = options;

  return new Promise((resolve, reject) => {
    let callbackResolve: ((url: string) => void) | null = null;
    let callbackReject: ((err: Error) => void) | null = null;
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;

    const server = http.createServer((req: IncomingMessage, res: ServerResponse) => {
      const reqUrl = new URL(req.url ?? '/', `http://${req.headers.host}`);

      // Only handle the callback path
      if (reqUrl.pathname !== path && reqUrl.pathname !== `${path}/`) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
        return;
      }

      if (req.method === 'POST') {
        // POST: read JSON body with the final callback URL and resolve
        let body = '';
        req.on('data', (chunk: Buffer) => {
          body += chunk.toString();
        });
        req.on('end', () => {
          try {
            const { url: callbackUrl } = JSON.parse(body);
            if (!callbackUrl || typeof callbackUrl !== 'string') {
              res.writeHead(400, { 'Content-Type': 'text/plain' });
              res.end('Missing url in request body');
              return;
            }

            // Send success response
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end('OK');

            // Resolve the callback promise
            if (callbackResolve) {
              callbackResolve(callbackUrl);
              callbackResolve = null;
              callbackReject = null;
            }

            // Stop the server after a short delay to ensure response is sent
            setTimeout(() => stopServer(), 100);
          } catch {
            res.writeHead(400, { 'Content-Type': 'text/plain' });
            res.end('Invalid JSON');
          }
        });
        return;
      }

      // GET: serve intermediate page that reads the fragment and POSTs back
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(getFragmentForwardingHtml());
    });

    server.on('error', (err: Error) => {
      if (!stopped) {
        reject(err);
      }
    });

    const stopServer = () => {
      if (stopped) return;
      stopped = true;

      // Clear the singleton reference
      if (activeServer?.stop === stopServer) {
        activeServer = null;
      }

      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
        timeoutHandle = null;
      }

      server.close();

      if (callbackReject) {
        callbackReject(new Error('Callback server stopped'));
        callbackResolve = null;
        callbackReject = null;
      }
    };

    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Failed to get server address'));
        return;
      }

      const actualPort = address.port;
      const redirectUri = `http://127.0.0.1:${actualPort}${path}`;

      console.log(`[oauth2] Callback server listening on ${redirectUri}`);

      const result: CallbackServerResult = {
        port: actualPort,
        redirectUri,
        waitForCallback: () => {
          return new Promise<string>((res, rej) => {
            if (stopped) {
              rej(new Error('Callback server already stopped'));
              return;
            }

            callbackResolve = res;
            callbackReject = rej;

            // Set timeout
            timeoutHandle = setTimeout(() => {
              if (callbackReject) {
                callbackReject(new Error('Authorization timed out'));
                callbackResolve = null;
                callbackReject = null;
              }
              stopServer();
            }, timeoutMs);
          });
        },
        stop: stopServer,
      };

      activeServer = result;
      resolve(result);
    });
  });
}

/**
 * Build the redirect URI for the hosted callback page.
 * The hosted page will redirect to the local server with the OAuth response.
 */
export function buildHostedCallbackRedirectUri(localPort: number, localPath: string): string {
  const localRedirectUri = `http://127.0.0.1:${localPort}${localPath}`;
  // The hosted callback page will read params and redirect to the local server
  return `${HOSTED_CALLBACK_URL}?redirect_to=${encodeURIComponent(localRedirectUri)}`;
}

/**
 * Stop the active callback server if one is running.
 * Called during plugin dispose to ensure the server is cleaned up before the process exits.
 */
export function stopActiveServer(): void {
  if (activeServer) {
    console.log('[oauth2] Stopping active callback server during dispose');
    activeServer.stop();
    activeServer = null;
  }
}

/**
 * Open an authorization URL in the system browser, start a local callback server,
 * and wait for the OAuth provider to redirect back.
 *
 * Returns the raw callback URL and the redirect URI that was registered with the
 * OAuth provider (needed for token exchange).
 */
export async function getRedirectUrlViaExternalBrowser(
  ctx: Context,
  authorizationUrl: URL,
  options: {
    callbackType: 'localhost' | 'hosted';
    callbackPort?: number;
  },
): Promise<{ callbackUrl: string; redirectUri: string }> {
  const { callbackType, callbackPort } = options;

  // Determine port based on callback type:
  // - localhost: use specified port or default stable port
  // - hosted: use random port (0) since hosted page redirects to local
  const port = callbackType === 'localhost' ? (callbackPort ?? DEFAULT_LOCALHOST_PORT) : 0;

  console.log(
    `[oauth2] Starting callback server (type: ${callbackType}, port: ${port || 'random'})`,
  );

  const server = await startCallbackServer({
    port,
    path: '/callback',
  });

  try {
    // Determine the redirect URI to send to the OAuth provider
    let oauthRedirectUri: string;

    if (callbackType === 'hosted') {
      oauthRedirectUri = buildHostedCallbackRedirectUri(server.port, '/callback');
      console.log('[oauth2] Using hosted callback redirect:', oauthRedirectUri);
    } else {
      oauthRedirectUri = server.redirectUri;
      console.log('[oauth2] Using localhost callback redirect:', oauthRedirectUri);
    }

    // Set the redirect URI on the authorization URL
    authorizationUrl.searchParams.set('redirect_uri', oauthRedirectUri);

    const authorizationUrlStr = authorizationUrl.toString();
    console.log('[oauth2] Opening external browser:', authorizationUrlStr);

    // Show toast to inform user
    await ctx.toast.show({
      message: 'Opening browser for authorization...',
      icon: 'info',
      timeout: 3000,
    });

    // Open the system browser
    await ctx.window.openExternalUrl(authorizationUrlStr);

    // Wait for the callback
    console.log('[oauth2] Waiting for callback on', server.redirectUri);
    const callbackUrl = await server.waitForCallback();

    console.log('[oauth2] Received callback:', callbackUrl);

    return { callbackUrl, redirectUri: oauthRedirectUri };
  } finally {
    server.stop();
  }
}

/**
 * Intermediate HTML page that reads the URL fragment and _fragment query param,
 * reconstructs a proper OAuth callback URL, and POSTs it back to the server.
 *
 * Handles three cases:
 * - Localhost implicit: fragment is in location.hash (e.g. #access_token=...)
 * - Hosted implicit: fragment was converted to ?_fragment=... by the hosted redirect page
 * - Auth code: no fragment, code is already in query params
 */
function getFragmentForwardingHtml(): string {
  return `<!DOCTYPE html>
<html>
<head>
  <title>Yaak</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      background: hsl(244,23%,14%);
      color: hsl(245,23%,85%);
    }
    .container { text-align: center; }
    .logo { display: block; width: 100px; height: 100px; margin: 0 auto 32px; border-radius: 50%; }
    h1 { font-size: 28px; font-weight: 600; margin-bottom: 12px; }
    p { font-size: 16px; color: hsl(245,18%,58%); }
  </style>
</head>
<body>
  <div class="container">
    <svg class="logo" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="0" gradientUnits="userSpaceOnUse" gradientTransform="matrix(649.94,712.03,-712.03,649.94,179.25,220.59)"><stop offset="0" stop-color="#4cc48c"/><stop offset=".5" stop-color="#476cc9"/><stop offset="1" stop-color="#ba1ab7"/></linearGradient></defs><rect x="0" y="0" width="1024" height="1024" fill="url(#g)"/><g transform="matrix(0.822,0,0,0.822,91.26,91.26)"><path d="M766.775,105.176C902.046,190.129 992.031,340.639 992.031,512C992.031,706.357 876.274,873.892 710,949.361C684.748,838.221 632.417,791.074 538.602,758.96C536.859,790.593 545.561,854.983 522.327,856.611C477.951,859.719 321.557,782.368 310.75,710.135C300.443,641.237 302.536,535.834 294.475,482.283C86.974,483.114 245.65,303.256 245.65,303.256L261.925,368.357L294.475,368.357C294.475,368.357 298.094,296.03 310.75,286.981C326.511,275.713 366.457,254.592 473.502,254.431C519.506,190.629 692.164,133.645 766.775,105.176ZM603.703,352.082C598.577,358.301 614.243,384.787 623.39,401.682C639.967,432.299 672.34,459.32 760.231,456.739C780.796,456.135 808.649,456.743 831.555,448.316C919.689,369.191 665.548,260.941 652.528,270.706C629.157,288.235 677.433,340.481 685.079,352.082C663.595,350.818 630.521,352.121 603.703,352.082ZM515.817,516.822C491.026,516.822 470.898,536.949 470.898,561.741C470.898,586.532 491.026,606.66 515.817,606.66C540.609,606.66 560.736,586.532 560.736,561.741C560.736,536.949 540.609,516.822 515.817,516.822ZM656.608,969.83C610.979,984.25 562.391,992.031 512,992.031C247.063,992.031 31.969,776.937 31.969,512C31.969,247.063 247.063,31.969 512,31.969C581.652,31.969 647.859,46.835 707.634,73.574C674.574,86.913 627.224,104.986 620,103.081C343.573,30.201 98.64,283.528 98.64,511.993C98.64,761.842 376.244,989.043 627.831,910C637.21,907.053 645.743,936.753 656.608,969.83Z" fill="#fff"/></g></svg>
    <h1 id="title">Authorizing...</h1>
    <p id="message">Please wait</p>
  </div>
  <script>
  (function() {
    var title = document.getElementById('title');
    var message = document.getElementById('message');
    var url = new URL(window.location.href);
    var fragment = window.location.hash;
    var fragmentParam = url.searchParams.get('_fragment');

    // Build the final callback URL:
    // 1. If _fragment query param exists (from hosted redirect), convert it back to a real fragment
    // 2. If location.hash exists (direct localhost implicit), use it as-is
    // 3. Otherwise (auth code flow), use the URL as-is with query params
    if (fragmentParam) {
      url.searchParams.delete('_fragment');
      url.hash = fragmentParam;
    } else if (fragment && fragment.length > 1) {
      url.hash = fragment;
    }

    // POST the final URL back to the callback server
    fetch(url.pathname, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: url.toString() })
    }).then(function(res) {
      if (res.ok) {
        title.textContent = 'Authorization Complete';
        message.textContent = 'You may close this tab and return to Yaak';
      } else {
        title.textContent = 'Authorization Failed';
        message.textContent = 'Something went wrong. Please try again.';
      }
    }).catch(function() {
      title.textContent = 'Authorization Failed';
      message.textContent = 'Something went wrong. Please try again.';
    });
  })();
  </script>
</body>
</html>`;
}
