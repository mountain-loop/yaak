/**
 * Sending an HTTP request from a tab.
 *
 * A tab can't see a response the way the desktop can — CORS hides most headers,
 * redirects are followed silently, there is no timeline — so the network half of
 * a send happens on a small stateless proxy (`crates-server/yaak-send-proxy`).
 * Everything else happens here, against this tab's own database, in the same
 * order the desktop does it:
 *
 *   1. create the `http_response` row (state: initialized);
 *   2. resolve and render the request in the worker (`prepare_http_send`: the
 *      environment chain, inherited headers and auth, request settings, cookie
 *      jar — the desktop's `HttpSendInputs`, in Rust, on the same model layer);
 *   3. POST the rendered request to the proxy and consume its stream: timeline
 *      events, the response head, body chunks, and a terminal frame;
 *   4. write what comes back where the desktop writes it — the response row as
 *      it progresses, `http_response_event` rows for the timeline, the body
 *      blob under the response id, the cookie jar with the proxy's changes.
 *
 * The proxy keeps nothing. Every byte it sees comes from this tab and every
 * byte it returns is stored by this tab.
 */

import type { WorkerConnection } from "./connection";
import type { ProxyFrame, ProxyRequestBody, ProxySendResponse } from "./proxy";
import { proxySendUrl, readFrames } from "./proxy";

/* -------------------------------- shapes --------------------------------- */

// The model types this file writes, spelled out rather than imported from
// `@yaakapp-internal/models`: the platform package sits underneath the model
// package in the dependency graph and must not import it.

interface HttpResponseHeader {
  name: string;
  value: string;
}

/** The subset of the `http_response` model this sender writes. */
interface ResponsePatch {
  model: "http_response";
  id: string;
  requestId: string;
  workspaceId: string;
  state: "initialized" | "connected" | "closed";
  url: string;
  status: number;
  statusReason: string | null;
  version: string | null;
  remoteAddr: string | null;
  headers: HttpResponseHeader[];
  requestHeaders: HttpResponseHeader[];
  contentLength: number | null;
  contentLengthCompressed: number | null;
  elapsed: number;
  elapsedHeaders: number;
  elapsedDns: number;
  error: string | null;
}

interface CookieJarModel {
  model: "cookie_jar";
  id: string;
  cookies: unknown[];
  [key: string]: unknown;
}

/** What `prepare_http_send` (crates/yaak-web) hands back. */
interface PreparedHttpSend {
  request: { url: string; [key: string]: unknown };
  settings: ProxyRequestBody["settings"];
  settingEvents: unknown[];
  cookieJar: CookieJarModel | null;
}

/** The desktop writes progress at most this often while a body streams in. */
const PROGRESS_INTERVAL_MS = 100;

/* --------------------------------- send ---------------------------------- */

export async function sendHttpRequest(
  db: WorkerConnection,
  requestId: string,
  environmentId: string | null,
  cookieJarId: string | null,
): Promise<unknown> {
  // The response row exists before anything can go wrong, as on the desktop, so
  // a failure to render or to reach the proxy lands in the response pane as
  // that response's error rather than as a toast that names no request.
  const workspaceId = await workspaceIdOfRequest(db, requestId);
  const response = new ResponseWriter(db, {
    model: "http_response",
    id: "",
    requestId,
    workspaceId,
    state: "initialized",
    url: "",
    status: 0,
    statusReason: null,
    version: null,
    remoteAddr: null,
    headers: [],
    requestHeaders: [],
    contentLength: null,
    contentLengthCompressed: null,
    elapsed: 0,
    elapsedHeaders: 0,
    elapsedDns: 0,
    error: null,
  });
  await response.create();

  const cancel = new AbortController();
  const unlistenCancel = db.listen(`cancel_http_response_${response.id}`, () => cancel.abort());

  try {
    await runSend(db, response, requestId, environmentId, cookieJarId, cancel.signal);
  } catch (err) {
    const message = cancel.signal.aborted ? "Request canceled" : errorMessage(err);
    await response.finish({ error: message });
  } finally {
    unlistenCancel();
  }
  return response.current();
}

async function runSend(
  db: WorkerConnection,
  response: ResponseWriter,
  requestId: string,
  environmentId: string | null,
  cookieJarId: string | null,
  signal: AbortSignal,
): Promise<void> {
  const prepared = await db.prepareHttpSend<PreparedHttpSend>({
    requestId,
    environmentId,
    cookieJarId,
  });
  await response.patch({ url: prepared.request.url });

  const timeline = new TimelineWriter(db, response.id, response.workspaceId);
  timeline.push(prepared.settingEvents);

  const body: ProxyRequestBody = {
    request: prepared.request,
    settings: prepared.settings,
    cookies: prepared.cookieJar?.cookies ?? null,
  };
  const startedAt = performance.now();
  const res = await fetch(proxySendUrl(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  }).catch((err: unknown) => {
    if (signal.aborted) throw err;
    throw new Error(`Couldn't reach the send proxy at ${proxySendUrl()}: ${errorMessage(err)}`);
  });

  if (!res.ok) {
    // A refusal, not a failed send: bad destination, rate limit, a body the
    // proxy can't build. It comes as JSON with the reason.
    const text = await res.text();
    let reason = text;
    try {
      reason = (JSON.parse(text) as { error?: string }).error ?? text;
    } catch {
      /* not JSON; the text is the reason */
    }
    throw new Error(reason || `The send proxy answered ${res.status}`);
  }
  if (res.body == null) throw new Error("The send proxy sent no body");

  const chunks: Uint8Array[] = [];
  let received = 0;
  let lastProgress = startedAt;
  let terminal: ProxyFrame | null = null;

  for await (const frame of readFrames(res.body)) {
    switch (frame.type) {
      case "event":
        timeline.push([frame.event]);
        break;
      case "response":
        await response.patch(headOf(frame));
        break;
      case "body": {
        const bytes = base64ToBytes(frame.data);
        chunks.push(bytes);
        received += bytes.byteLength;
        const now = performance.now();
        if (now - lastProgress >= PROGRESS_INTERVAL_MS) {
          lastProgress = now;
          await response.patch({
            contentLength: received,
            elapsed: Math.round(now - startedAt),
          });
        }
        break;
      }
      case "done":
      case "error":
        terminal = frame;
        break;
    }
    if (terminal != null) break;
  }

  // Everything the proxy said about the timeline is in the database before the
  // response is marked closed, so a reader that wakes on "closed" sees all of it.
  await timeline.flush();

  if (terminal == null) {
    throw new Error("The send proxy closed the stream without finishing");
  }

  // Cookies come back on both outcomes: a hop before the failing one may have
  // set some, and the desktop keeps those too.
  if (prepared.cookieJar != null && terminal.cookies != null) {
    await persistCookies(db, prepared.cookieJar, terminal.cookies);
  }

  if (terminal.type === "error") {
    throw new Error(terminal.message);
  }

  // The body is written under the response id, which is how every reader —
  // `cmd_http_response_body`, the image viewer, the download button — asks for
  // it. One write, once the whole body is here: the worker's blob store has no
  // append, and a body larger than memory is over the proxy's cap anyway.
  await db.blobPut(response.id, concat(chunks, received));
  await response.finish({
    contentLength: terminal.contentLength,
    contentLengthCompressed: terminal.contentLengthCompressed,
    elapsed: terminal.elapsed,
  });
}

function headOf(frame: ProxySendResponse): Partial<ResponsePatch> {
  return {
    state: "connected",
    status: frame.status,
    statusReason: frame.statusReason,
    url: frame.url,
    remoteAddr: frame.remoteAddr,
    version: frame.version,
    headers: frame.headers,
    requestHeaders: frame.requestHeaders,
    contentLength: frame.contentLength,
    elapsedHeaders: frame.elapsedHeaders,
    elapsedDns: frame.elapsedDns,
  };
}

/* ------------------------------- helpers --------------------------------- */

/**
 * The response row, written the way the desktop writes it: created empty,
 * patched as the send progresses, closed at the end. Each write goes through
 * `models_upsert`, so every tab on this database sees the response land.
 */
class ResponseWriter {
  private state: ResponsePatch;

  constructor(
    private readonly db: WorkerConnection,
    initial: ResponsePatch,
  ) {
    this.state = initial;
  }

  get id(): string {
    return this.state.id;
  }

  get workspaceId(): string {
    return this.state.workspaceId;
  }

  current(): ResponsePatch {
    return this.state;
  }

  async create(): Promise<void> {
    const { id: _, ...withoutId } = this.state;
    const id = await this.db.rpc<string>("models_upsert", { model: withoutId });
    this.state = { ...this.state, id };
  }

  async patch(patch: Partial<ResponsePatch>): Promise<void> {
    // Structured clone carries `undefined` across to the worker as a present
    // key, and the model layer reads that as "wrong type" and refuses the whole
    // model. Nothing here should produce one, but a missing wire field must
    // not take the response row down with it.
    const defined = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    this.state = { ...this.state, ...defined };
    await this.db.rpc("models_upsert", { model: this.state });
  }

  async finish(patch: Partial<ResponsePatch>): Promise<void> {
    await this.patch({ ...patch, state: "closed" });
  }
}

/**
 * Timeline events, written in the order they arrived. Writes are chained rather
 * than awaited inline so a burst of `header_down` events doesn't serialise the
 * body read behind a database round trip each, and `flush()` is the point at
 * which the whole timeline is known to be in the database.
 */
class TimelineWriter {
  private queue: unknown[] = [];
  private inFlight: Promise<void> = Promise.resolve();

  constructor(
    private readonly db: WorkerConnection,
    private readonly responseId: string,
    private readonly workspaceId: string,
  ) {}

  push(events: unknown[]): void {
    if (events.length === 0) return;
    this.queue.push(...events);
    this.inFlight = this.inFlight.then(() => this.drain());
  }

  private async drain(): Promise<void> {
    if (this.queue.length === 0) return;
    const events = this.queue;
    this.queue = [];
    await this.db.rpc("web_insert_http_response_events", {
      responseId: this.responseId,
      workspaceId: this.workspaceId,
      events,
    });
  }

  flush(): Promise<void> {
    return this.inFlight;
  }
}

async function persistCookies(
  db: WorkerConnection,
  jar: CookieJarModel,
  cookies: unknown[],
): Promise<void> {
  // The desktop compares before writing so a jar edited mid-send isn't clobbered
  // by an unchanged copy. Structural equality is enough here: cookies are plain
  // data and the proxy hands back the whole jar.
  if (JSON.stringify(cookies) === JSON.stringify(jar.cookies)) return;
  await db.rpc("models_upsert", { model: { ...jar, cookies } });
}

/**
 * The request's workspace, needed to create the response row before the worker
 * has resolved the request (which is where a render refusal would land).
 */
async function workspaceIdOfRequest(db: WorkerConnection, requestId: string): Promise<string> {
  const req = await db.rpc<{ workspaceId: string }>("web_get_http_request", { requestId });
  return req.workspaceId;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function base64ToBytes(data: string): Uint8Array {
  const bin = atob(data);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function concat(chunks: Uint8Array[], total: number): Uint8Array {
  if (chunks.length === 1) return chunks[0]!;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}
