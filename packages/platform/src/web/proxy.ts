/**
 * The wire to the send proxy: where it is, and how to read what comes back.
 *
 * The shapes themselves are generated from `crates-server/yaak-send-proxy/src/wire.rs`
 * into `@yaakapp-internal/send-proxy`, so the two sides cannot drift silently.
 */

import type { Frame } from "@yaakapp-internal/send-proxy";

/* ------------------------------- location -------------------------------- */

/**
 * Where the tab sends. Build-time configuration for now: `VITE_YAAK_SEND_PROXY_URL`
 * (Vite exposes `VITE_*` to the bundle), defaulting to a proxy on this machine at
 * its default port. A per-user setting can replace this later without touching
 * the callers, which only ever ask for the URL.
 */
export function proxyBaseUrl(): string {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  const configured = env?.VITE_YAAK_SEND_PROXY_URL?.trim();
  return (configured || "http://127.0.0.1:9227").replace(/\/+$/, "");
}

export function proxySendUrl(): string {
  return `${proxyBaseUrl()}/v1/http/send`;
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
