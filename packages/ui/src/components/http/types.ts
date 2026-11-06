/**
 * What the shared request and response panes render. Each app maps its own models onto these
 * (the client its `HttpRequest` and `HttpResponse`, the proxy a captured `Flow`), so the panes
 * never import either app's model types.
 */

export const BODY_TYPE_NONE = null;
export const BODY_TYPE_GRAPHQL = "graphql";
export const BODY_TYPE_JSON = "application/json";
export const BODY_TYPE_BINARY = "binary";
export const BODY_TYPE_OTHER = "other";
export const BODY_TYPE_FORM_URLENCODED = "application/x-www-form-urlencoded";
export const BODY_TYPE_FORM_MULTIPART = "multipart/form-data";
export const BODY_TYPE_XML = "text/xml";

/** A header, URL parameter or form field */
export interface HttpPairView {
  id?: string;
  name: string;
  value: string;
  enabled?: boolean;
}

/** A form field. A multipart file field has the file's path in `file` instead of a `value` */
export interface HttpFormFieldView {
  id?: string;
  name: string;
  value?: string;
  enabled?: boolean;
  file?: string;
  contentType?: string;
  filename?: string;
}

/** A request body, in the shape its body type edits it */
export interface HttpRequestBodyView {
  /** Text bodies: JSON, XML, GraphQL's query, anything else typed */
  text?: string;
  /** Form bodies, url-encoded or multipart */
  form?: HttpFormFieldView[];
  /** A binary body read from a file when sent */
  filePath?: string;
  /** JSON sent as written, comments and all, instead of cleaned up first */
  sendJsonComments?: boolean;
}

/** Authentication, for display only; editing it stays with the app that knows its plugins */
export interface HttpAuthView {
  /** The scheme's name, like `Bearer` or `Basic` */
  label: string;
  /** What it sends, like an `Authorization` header */
  values: HttpPairView[];
}

export interface HttpRequestView {
  /** Identifies the request across renders, for remembered tabs and editor state */
  id: string;
  method: string;
  url: string;
  headers: HttpPairView[];
  urlParameters: HttpPairView[];
  /** One of the `BODY_TYPE_*` values, or a content type the body was typed as */
  bodyType: string | null;
  body: HttpRequestBodyView;
  /** The request's Content-Type header */
  contentType: string | null;
  auth: HttpAuthView | null;
}

export type HttpResponseViewState = "initialized" | "connected" | "closed";

export interface HttpResponseView {
  /** Identifies this response, for viewer state */
  id: string;
  /** Identifies what it answers (the request or flow), for state kept across responses */
  ownerId: string;
  state: HttpResponseViewState;
  /** 0 before a status arrives or when it never did */
  status: number;
  statusReason: string | null;
  url: string;
  headers: HttpPairView[];
  requestHeaders: HttpPairView[];
  /** The response's Content-Type header */
  contentType: string | null;
  /** Decoded body bytes */
  contentLength: number | null;
  /** Body bytes on the wire, when it was compressed */
  contentLengthCompressed: number | null;
  /** Request body bytes sent */
  requestContentLength: number | null;
  /** When the request started, as an ISO 8601 string with its zone */
  startedAt: string;
  elapsedMs: number;
  elapsedHeadersMs: number;
  elapsedDnsMs: number;
  error: string | null;
  remoteAddr: string | null;
  version: string | null;
  /** Raw `Cookie` header values sent and `Set-Cookie` values received */
  cookieHeaders: { sent: string[]; received: string[] };
}

/** What a viewer gets back from loading part of a body */
export interface HttpBodyResult<T> {
  data: T | undefined;
  isLoading: boolean;
  error: Error | null;
}

/**
 * How a pane reads a body, which each app stores its own way: the client in files read
 * through its host, the proxy through the engine's body RPC. Each `use*` is a hook, called
 * unconditionally by the viewer that needs that form of the body.
 */
export interface HttpBodyLoader {
  /** The body as text, null when there's none */
  useText: () => HttpBodyResult<string | null>;
  /** The body's bytes, null when there's none */
  useBytes: () => HttpBodyResult<Uint8Array | null>;
  /** A URL a media element can load the body from, null when there's none or not `enabled` */
  useUrl: (enabled: boolean) => HttpBodyResult<string | null>;
  /** Run a JSONPath or XPath filter over the body */
  filterText?: (expression: string) => Promise<string | null>;
  /** The body's text, for copying, without rendering it */
  getText?: () => Promise<string | null>;
}
