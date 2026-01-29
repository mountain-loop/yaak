import type { IncomingMessage, ServerResponse } from 'node:http';
import http from 'node:http';

const HOSTED_CALLBACK_URL = 'https://yaak.app/oauth-callback';
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
  <title>Yaak Authorization Complete</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
    }
    .container {
      text-align: center;
      padding: 48px;
      background: rgba(255, 255, 255, 0.1);
      border-radius: 16px;
      backdrop-filter: blur(10px);
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
    }
    .checkmark {
      width: 80px;
      height: 80px;
      margin: 0 auto 24px;
      background: rgba(255, 255, 255, 0.2);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 40px;
    }
    h1 {
      font-size: 24px;
      font-weight: 600;
      margin-bottom: 12px;
    }
    p {
      font-size: 16px;
      opacity: 0.9;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="checkmark">&#10003;</div>
    <h1>Authorization Complete</h1>
    <p>You can close this window and return to Yaak.</p>
  </div>
  <script>
    // Attempt to close the window after a short delay
    setTimeout(function() { window.close(); }, 2000);
  </script>
</body>
</html>`;
}
