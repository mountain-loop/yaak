/**
 * Sending an HTTP request from a tab.
 *
 * A tab can't see a response the way the desktop can — CORS hides most headers,
 * redirects are followed silently, there is no timeline — so the network half of
 * a send happens on a small stateless server (`crates-server/yaak-web`).
 * Everything else happens here, against this tab's own database, in the same
 * order the desktop does it:
 *
 *   1. create the `http_response` row (state: initialized);
 *   2. resolve and render the request in the worker (`prepare_http_send`: the
 *      environment chain, inherited headers and auth, request settings, cookie
 *      jar — the desktop's `HttpSendInputs`, in Rust, on the same model layer);
 *   3. POST the rendered request to the server and consume its stream: timeline
 *      events, the response head, body chunks, and a terminal frame;
 *   4. write what comes back where the desktop writes it — the response row as
 *      it progresses, `http_response_event` rows for the timeline, the body
 *      blob under the response id, the cookie jar with the server's changes.
 *
 * The server keeps nothing. Every byte it sees comes from this tab and every
 * byte it returns is stored by this tab.
 */

// Types only: the models package imports this one at runtime, and a type import
// is erased, so there is no cycle.
import type {
  Cookie,
  CookieJar,
  HttpRequest,
  HttpResponse,
  HttpResponseEventData,
  HttpSendSettings,
} from "@yaakapp-internal/models";
import type { Frame, SendRequest } from "@yaakapp-internal/web";
import type { WorkerConnection } from "./connection";
import { serverIdentity, serverSendUrl, readFrames } from "./server";

/* -------------------------------- shapes --------------------------------- */

/**
 * The response row as this file knows it: what identifies it, plus whatever
 * has been written so far. Every other field is optional and takes the model
 * layer's default when absent, the same way the desktop's row does — defaults
 * live in Rust, once.
 */
type ResponseRow = Pick<HttpResponse, "model" | "requestId" | "workspaceId"> &
  Partial<Omit<HttpResponse, "model" | "requestId" | "workspaceId">>;

type ResponsePatch = Partial<HttpResponse>;

/** What `prepare_http_send` (crates/yaak-wasm) hands back. */
interface PreparedHttpSend {
  request: HttpRequest;
  settings: HttpSendSettings;
  settingEvents: HttpResponseEventData[];
  cookieJar: CookieJar | null;
}

/** The desktop writes progress at most this often while a body streams in. */
const PROGRESS_INTERVAL_MS = 100;

/* --------------------------------- send ---------------------------------- */

export async function sendHttpRequest(
  db: WorkerConnection,
  requestId: string,
  environmentId: string | null,
  cookieJarId: string | null,
): Promise<ResponseRow> {
  // The response row exists before anything can go wrong, as on the desktop, so
  // a failure to render or to reach the server lands in the response pane as
  // that response's error rather than as a toast that names no request.
  const workspaceId = await workspaceIdOfRequest(db, requestId);
  const response = new ResponseWriter(db, { model: "http_response", requestId, workspaceId });
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

  // The first line of the timeline says what did the sending and where. A
  // request through a proxy shows a different origin to the server than the
  // user's machine, and this is where that should be visible.
  const timeline = new TimelineWriter(db, response.id, response.workspaceId);
  timeline.push([{ type: "info", message: `Executed by ${await serverIdentity()}` }]);
  timeline.push(prepared.settingEvents);

  const body: SendRequest = {
    request: prepared.request,
    settings: prepared.settings,
    cookies: prepared.cookieJar?.cookies ?? null,
  };
  const startedAt = performance.now();
  const res = await fetch(serverSendUrl(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  }).catch((err: unknown) => {
    if (signal.aborted) throw err;
    throw new Error(`Couldn't reach the Yaak server at ${serverSendUrl()}: ${errorMessage(err)}`);
  });

  if (!res.ok) {
    // A refusal, not a failed send: bad destination, rate limit, a body the
    // server can't build. It comes as JSON with the reason.
    const text = await res.text();
    let reason = text;
    try {
      reason = (JSON.parse(text) as { error?: string }).error ?? text;
    } catch {
      /* not JSON; the text is the reason */
    }
    throw new Error(reason || `The Yaak server answered ${res.status}`);
  }
  if (res.body == null) throw new Error("The Yaak server sent no body");

  const chunks: Uint8Array[] = [];
  let received = 0;
  let lastProgress = startedAt;
  let terminal: Frame | null = null;

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

  // Everything the server said about the timeline is in the database before the
  // response is marked closed, so a reader that wakes on "closed" sees all of it.
  await timeline.flush();

  if (terminal == null) {
    throw new Error("The Yaak server closed the stream without finishing");
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
  // append, and a body larger than memory is over the server's cap anyway.
  await db.blobPut(response.id, concat(chunks, received));
  await response.finish({
    contentLength: terminal.contentLength,
    contentLengthCompressed: terminal.contentLengthCompressed,
    elapsed: terminal.elapsed,
  });
}

function headOf(frame: Extract<Frame, { type: "response" }>): ResponsePatch {
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
  private state: ResponseRow;

  constructor(
    private readonly db: WorkerConnection,
    initial: ResponseRow,
  ) {
    this.state = initial;
  }

  get id(): string {
    return this.state.id ?? "";
  }

  get workspaceId(): string {
    return this.state.workspaceId;
  }

  current(): ResponseRow {
    return this.state;
  }

  /** Create the row. Everything but its identity is the model layer's default. */
  async create(): Promise<void> {
    const id = await this.db.rpc<string>("models_upsert", { model: this.state });
    this.state = { ...this.state, id };
  }

  async patch(patch: ResponsePatch): Promise<void> {
    // Structured clone carries `undefined` across to the worker as a present
    // key, and the model layer reads that as "wrong type" and refuses the whole
    // model. Nothing here should produce one, but a missing wire field must
    // not take the response row down with it.
    const defined = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    this.state = { ...this.state, ...defined };
    await this.db.rpc("models_upsert", { model: this.state });
  }

  async finish(patch: ResponsePatch): Promise<void> {
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
  private queue: HttpResponseEventData[] = [];
  private inFlight: Promise<void> = Promise.resolve();

  constructor(
    private readonly db: WorkerConnection,
    private readonly responseId: string,
    private readonly workspaceId: string,
  ) {}

  push(events: HttpResponseEventData[]): void {
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

/**
 * Carry the send's cookie changes into the jar. The worker applies them as a
 * difference against the jar as it is now (see `apply_cookie_changes` in
 * yaak-models), so an edit made while the send was in flight survives rather
 * than being written over by the send's stale snapshot.
 */
async function persistCookies(db: WorkerConnection, jar: CookieJar, cookies: Cookie[]): Promise<void> {
  await db.rpc("web_persist_send_cookies", { cookieJarId: jar.id, before: jar.cookies, after: cookies });
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
