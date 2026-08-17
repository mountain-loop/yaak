/**
 * The wire to the send proxy: where it is, what goes up, and what comes back.
 *
 * These shapes mirror `crates-server/yaak-send-proxy/src/wire.rs` by hand. The
 * proxy is a separate binary with its own release cadence, so the contract is
 * written down on both sides rather than generated across them; a change to one
 * is a change to the other, and the frame `type` tags are the versioning.
 */

import type {
  Cookie,
  HttpRequest,
  HttpResponseEventData,
  HttpResponseHeader,
} from "@yaakapp-internal/models";

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

/* --------------------------------- up ------------------------------------ */

/** The body of `POST /v1/http/send`. */
export interface ProxyRequestBody {
  /** The rendered request, in the model shape (see `wire.rs` `SendRequest.request`). */
  request: HttpRequest;
  settings: {
    validateCertificates: boolean;
    followRedirects: boolean;
    timeoutMs: number;
    sendCookies: boolean;
    storeCookies: boolean;
  };
  /** The jar's cookies to start from, or `null` for no jar at all. */
  cookies: Cookie[] | null;
}

/* -------------------------------- down ----------------------------------- */

export interface ProxySendResponse {
  type: "response";
  status: number;
  statusReason: string | null;
  url: string;
  remoteAddr: string | null;
  version: string | null;
  headers: HttpResponseHeader[];
  requestHeaders: HttpResponseHeader[];
  contentLength: number | null;
  elapsedHeaders: number;
  elapsedDns: number;
}

export type ProxyFrame =
  /** A timeline event in the `http_response_event.event` shape. */
  | { type: "event"; event: HttpResponseEventData }
  | ProxySendResponse
  /** A body chunk, decompressed, base64. */
  | { type: "body"; data: string }
  | {
      type: "done";
      elapsed: number;
      contentLength: number;
      contentLengthCompressed: number;
      cookies: Cookie[] | null;
    }
  | { type: "error"; message: string; cookies: Cookie[] | null };

/**
 * Yield frames from an NDJSON stream as they arrive. A partial trailing line is
 * held until its newline comes; anything left when the stream ends is dropped,
 * because a frame without its newline is a frame the proxy didn't finish writing.
 */
export async function* readFrames(stream: ReadableStream<Uint8Array>): AsyncGenerator<ProxyFrame> {
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
        if (line.trim() !== "") yield JSON.parse(line) as ProxyFrame;
        newline = buffer.indexOf("\n");
      }
    }
  } finally {
    reader.releaseLock();
  }
}
