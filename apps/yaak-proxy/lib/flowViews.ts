import type { Flow, GetFlowBodyResponse, ProxyHeader } from "@yaakapp-internal/proxy-lib";
import {
  BODY_TYPE_BINARY,
  BODY_TYPE_FORM_MULTIPART,
  BODY_TYPE_FORM_URLENCODED,
  BODY_TYPE_JSON,
  BODY_TYPE_OTHER,
  BODY_TYPE_XML,
  type HttpAuthView,
  type HttpBodyLoader,
  type HttpBodyResult,
  type HttpPairView,
  type HttpRequestBodyView,
  type HttpRequestView,
  type HttpResponseView,
} from "@yaakapp-internal/ui/httpTypes";
import { useEffect, useState } from "react";
import { base64ToBytes, bytesToText, findHeader, mimeEssence } from "./body";
import { statusReason } from "./statusReason";

/** A captured body as the engine's body RPC returns it, decoded */
export interface FlowBodyData {
  bytes: Uint8Array<ArrayBuffer>;
  truncated: boolean;
  storedSize: number;
}

export function flowBodyFromRpc(res: GetFlowBodyResponse): FlowBodyData {
  return { bytes: base64ToBytes(res.data), truncated: res.truncated, storedSize: res.storedSize };
}

/** A captured request as the shared request pane shows it, read-only */
export function flowRequestToView(flow: Flow, body: FlowBodyData | null): HttpRequestView {
  const contentType = findHeader(flow.requestHeaders, "content-type");
  const text = body == null ? null : bytesToText(body.bytes, body.truncated);
  const { bodyType, body: bodyView } = requestBodyView(contentType, body, text);

  return {
    id: flow.id,
    method: flow.method,
    url: flow.url,
    headers: headersToPairs(flow.requestHeaders),
    urlParameters: queryToPairs(flow.url),
    bodyType,
    body: bodyView,
    contentType,
    auth: authFromHeaders(flow.requestHeaders),
  };
}

/** The body type a captured body reads as, in the shape that body type's editor shows */
function requestBodyView(
  contentType: string | null,
  body: FlowBodyData | null,
  text: string | null,
): { bodyType: string | null; body: HttpRequestBodyView } {
  if (body == null || body.bytes.length === 0) return { bodyType: null, body: {} };

  const mime = mimeEssence(contentType) ?? "";
  if (mime.startsWith("multipart/")) return { bodyType: BODY_TYPE_FORM_MULTIPART, body: {} };
  if (text == null) return { bodyType: BODY_TYPE_BINARY, body: {} };
  if (mime === BODY_TYPE_FORM_URLENCODED) {
    return { bodyType: BODY_TYPE_FORM_URLENCODED, body: { form: formToPairs(text) } };
  }
  if (mime === "application/json" || mime.endsWith("+json")) {
    // Captured as sent, so nothing was cleaned up before it went out
    return { bodyType: BODY_TYPE_JSON, body: { text, sendJsonComments: true } };
  }
  if (mime === "text/xml" || mime === "application/xml" || mime.endsWith("+xml")) {
    return { bodyType: BODY_TYPE_XML, body: { text } };
  }
  return { bodyType: BODY_TYPE_OTHER, body: { text } };
}

/**
 * A captured response as the shared response pane shows it, or null when the request never
 * got one and didn't fail either (it's still waiting).
 */
export function flowResponseToView(flow: Flow): HttpResponseView | null {
  const ended = flow.elapsedMs != null || flow.error != null || flow.cancelled;
  if (flow.status == null && !ended) return null;

  return {
    id: flow.id,
    ownerId: flow.id,
    state: ended ? "closed" : "connected",
    status: flow.status ?? 0,
    statusReason: flow.status == null ? null : statusReason(flow.status),
    url: flow.url,
    headers: headersToPairs(flow.responseHeaders),
    requestHeaders: headersToPairs(flow.requestHeaders),
    contentType: findHeader(flow.responseHeaders, "content-type"),
    contentLength: flow.responseSize,
    contentLengthCompressed: null,
    requestContentLength: flow.requestSize,
    startedAt: flow.startedAt,
    elapsedMs: flow.elapsedMs ?? 0,
    elapsedHeadersMs: flow.elapsedHeadersMs ?? 0,
    elapsedDnsMs: 0,
    error: flow.error ?? (flow.cancelled && flow.status == null ? "Cancelled by the client" : null),
    remoteAddr: flow.remoteAddr,
    version: flow.upstreamHttpVersion ?? flow.clientHttpVersion,
    cookieHeaders: {
      sent: headerValues(flow.requestHeaders, "cookie"),
      received: headerValues(flow.responseHeaders, "set-cookie"),
    },
  };
}

/**
 * Reads a captured body the ways the shared viewers ask for it. `useBody` is the hook that
 * loads it, the engine's body RPC in the app or a fixture in tests.
 */
export function flowBodyLoader({
  useBody,
  contentType,
  filterText,
}: {
  useBody: () => HttpBodyResult<FlowBodyData | null>;
  contentType: string | null;
  filterText?: (expression: string) => Promise<string | null>;
}): HttpBodyLoader {
  return {
    useText: () => {
      const body = useBody();
      return { ...body, data: mapData(body, (b) => bytesToText(b.bytes, b.truncated)) };
    },
    useBytes: () => {
      const body = useBody();
      return { ...body, data: mapData(body, (b) => b.bytes) };
    },
    useUrl: (enabled: boolean) => {
      const body = useBody();
      const bytes = enabled ? (body.data?.bytes ?? null) : null;
      const url = useObjectUrl(bytes, contentType);
      // The URL follows the bytes by a render
      const waiting = bytes != null && bytes.length > 0 && url == null;
      return { ...body, isLoading: !enabled || body.isLoading || waiting, data: url };
    },
    filterText,
  };
}

function mapData<T>(
  body: HttpBodyResult<FlowBodyData | null>,
  fn: (b: FlowBodyData) => T,
): T | null | undefined {
  if (body.data === undefined) return undefined;
  if (body.data == null || body.data.bytes.length === 0) return null;
  return fn(body.data);
}

/** A URL for bytes held in memory, revoked when they change */
function useObjectUrl(bytes: Uint8Array<ArrayBuffer> | null, contentType: string | null) {
  const [url, setUrl] = useState<string | null>(null);
  // Made and revoked by the same effect, so a remount can't revoke a URL still in use
  useEffect(() => {
    if (bytes == null || bytes.length === 0) {
      setUrl(null);
      return;
    }
    const next = URL.createObjectURL(new Blob([bytes], { type: mimeEssence(contentType) ?? "" }));
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [bytes, contentType]);
  return url;
}

function headersToPairs(headers: ProxyHeader[]): HttpPairView[] {
  return headers.map((h, i) => ({ id: `${i}`, name: h.name, value: h.value, enabled: true }));
}

function headerValues(headers: ProxyHeader[], name: string): string[] {
  return headers.filter((h) => h.name.toLowerCase() === name).map((h) => h.value);
}

/** A URL's query string as parameters, in order, repeats kept */
export function queryToPairs(url: string): HttpPairView[] {
  const query = url.split("#")[0]?.split("?").slice(1).join("?") ?? "";
  return formToPairs(query);
}

/** `a=1&b=2` as pairs, decoded the way a form or query string is */
export function formToPairs(text: string): HttpPairView[] {
  if (text === "") return [];
  return text.split("&").map((part, i) => {
    const [name = "", ...rest] = part.split("=");
    return {
      id: `${i}`,
      name: decodeFormPart(name),
      value: decodeFormPart(rest.join("=")),
      enabled: true,
    };
  });
}

function decodeFormPart(s: string): string {
  try {
    return decodeURIComponent(s.replaceAll("+", " "));
  } catch {
    return s;
  }
}

/** What the request authenticated with, named by its scheme, for display */
export function authFromHeaders(headers: ProxyHeader[]): HttpAuthView | null {
  const value = findHeader(headers, "authorization");
  if (value == null) return null;
  const scheme = value.split(" ")[0]?.toLowerCase() ?? "";
  return { label: AUTH_SCHEMES[scheme] ?? "Auth", values: [{ name: "Authorization", value }] };
}

const AUTH_SCHEMES: Record<string, string> = {
  basic: "Basic",
  bearer: "Bearer",
  digest: "Digest",
  ntlm: "NTLM",
  negotiate: "Negotiate",
  "aws4-hmac-sha256": "AWS",
};
