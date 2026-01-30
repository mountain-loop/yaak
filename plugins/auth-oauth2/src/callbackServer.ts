import type { IncomingMessage, ServerResponse } from 'node:http';
import http from 'node:http';

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

      // Build the full callback URL
      const fullCallbackUrl = reqUrl.toString();

      // Send success response
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(getSuccessHtml());

      // Resolve the callback promise
      if (callbackResolve) {
        callbackResolve(fullCallbackUrl);
        callbackResolve = null;
        callbackReject = null;
      }

      // Stop the server after a short delay to ensure response is sent
      setTimeout(() => stopServer(), 100);
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
 * HTML page shown to the user after successful callback
 */
function getSuccessHtml(): string {
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
    .logo { width: 100px; height: 100px; margin: 0 auto 32px; border-radius: 50%; }
    h1 { font-size: 28px; font-weight: 600; margin-bottom: 12px; }
    p { font-size: 16px; color: hsl(245,18%,58%); }
  </style>
</head>
<body>
  <div class="container">
    <svg class="logo" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="0" gradientUnits="userSpaceOnUse" gradientTransform="matrix(649.94,712.03,-712.03,649.94,179.25,220.59)"><stop offset="0" stop-color="#4cc48c"/><stop offset=".5" stop-color="#476cc9"/><stop offset="1" stop-color="#ba1ab7"/></linearGradient></defs><rect x="0" y="0" width="1024" height="1024" fill="url(#g)"/><g transform="matrix(0.822,0,0,0.822,91.26,91.26)"><path d="M766.775,105.176C902.046,190.129 992.031,340.639 992.031,512C992.031,706.357 876.274,873.892 710,949.361C684.748,838.221 632.417,791.074 538.602,758.96C536.859,790.593 545.561,854.983 522.327,856.611C477.951,859.719 321.557,782.368 310.75,710.135C300.443,641.237 302.536,535.834 294.475,482.283C86.974,483.114 245.65,303.256 245.65,303.256L261.925,368.357L294.475,368.357C294.475,368.357 298.094,296.03 310.75,286.981C326.511,275.713 366.457,254.592 473.502,254.431C519.506,190.629 692.164,133.645 766.775,105.176ZM603.703,352.082C598.577,358.301 614.243,384.787 623.39,401.682C639.967,432.299 672.34,459.32 760.231,456.739C780.796,456.135 808.649,456.743 831.555,448.316C919.689,369.191 665.548,260.941 652.528,270.706C629.157,288.235 677.433,340.481 685.079,352.082C663.595,350.818 630.521,352.121 603.703,352.082ZM515.817,516.822C491.026,516.822 470.898,536.949 470.898,561.741C470.898,586.532 491.026,606.66 515.817,606.66C540.609,606.66 560.736,586.532 560.736,561.741C560.736,536.949 540.609,516.822 515.817,516.822ZM656.608,969.83C610.979,984.25 562.391,992.031 512,992.031C247.063,992.031 31.969,776.937 31.969,512C31.969,247.063 247.063,31.969 512,31.969C581.652,31.969 647.859,46.835 707.634,73.574C674.574,86.913 627.224,104.986 620,103.081C343.573,30.201 98.64,283.528 98.64,511.993C98.64,761.842 376.244,989.043 627.831,910C637.21,907.053 645.743,936.753 656.608,969.83Z" fill="#fff"/></g></svg>
    <h1>Authorization Complete</h1>
    <p>You may close this tab and return to Yaak</p>
  </div>
</body>
</html>`;
}
