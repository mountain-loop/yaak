/**
 * The wire to the send proxy: where it is, and how to read what comes back.
 *
 * The shapes themselves are generated from `crates-server/yaak-send-proxy/src/wire.rs`
 * into `@yaakapp-internal/send-proxy`, so the two sides cannot drift silently.
 */

import type { Frame } from "@yaakapp-internal/send-proxy";

/* ------------------------------- location -------------------------------- */

/**
 * Where the tab sends.
 *
 * Empty means "this origin": the proxy can serve the app itself
 * (`yaak-send-proxy --serve-web`), and then a send is a request to a path on the
 * page's own origin — no CORS, and nothing for a self-hoster to configure.
 *
 * `VITE_YAAK_SEND_PROXY_URL` overrides it at build time, for a deployment that
 * keeps the two apart. The dev server is one of those: it serves the app on its
 * own origin and knows nothing about `/v1`, so a dev build falls back to a proxy
 * running locally (`cargo run -p yaak-send-proxy`).
 */
export function proxyBaseUrl(): string {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  const configured = env?.VITE_YAAK_SEND_PROXY_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  return env?.DEV ? "http://127.0.0.1:9227" : "";
}

export function proxySendUrl(): string {
  return `${proxyBaseUrl()}/v1/http/send`;
}

let identity: Promise<string> | null = null;

/** The proxy's location as a person reads it, since "" means "this origin". */
function proxyLocation(): string {
  return proxyBaseUrl() || globalThis.location?.origin || "this origin";
}

/**
 * Who does the sending, for the timeline: `yaak-send-proxy 0.1.0 at http://…`.
 * Asked of `/v1/health` once per page load; if the proxy can't be reached the
 * URL alone is the answer, and the send itself will say why shortly after.
 */
export function proxyIdentity(): Promise<string> {
  identity ??= fetch(`${proxyBaseUrl()}/v1/health`)
    .then((res) => res.json() as Promise<{ version?: string }>)
    .then((health) => `yaak-send-proxy ${health.version ?? ""} at ${proxyLocation()}`.replace("  ", " "))
    .catch(() => {
      identity = null; // try again next send
      return `send proxy at ${proxyLocation()}`;
    });
  return identity;
}

/**
 * Yield frames from an NDJSON stream as they arrive. A partial trailing line is
 * held until its newline comes; anything left when the stream ends is dropped,
 * because a frame without its newline is a frame the proxy didn't finish writing.
 */
export async function* readFrames(stream: ReadableStream<Uint8Array>): AsyncGenerator<Frame> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf("\n");
      while (newline !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (line.trim() !== "") yield JSON.parse(line) as Frame;
        newline = buffer.indexOf("\n");
      }
    }
  } finally {
    reader.releaseLock();
  }
}
