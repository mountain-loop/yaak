/**
 * A tab's end of the wire to the worker that owns the database.
 *
 * Constructible synchronously and usable immediately, which is the hard
 * requirement: boot-time modules call commands while the module graph is still
 * evaluating, so there is no later moment to connect in. Messages posted before
 * the worker has opened the database sit in the port until it has, and the
 * app's own top-level await then doubles as the boot gate — nothing renders
 * until the first command has answered, and it can only answer once the
 * database is open.
 */

import type { Unsubscribe } from "../types";
import { type FromWorker, type ToWorker, WORKER_NAME } from "./protocol";

/**
 * How long a freshly connected worker gets to say hello.
 *
 * A live worker answers in the same turn it is connected — the worker script
 * is tiny and imports the model layer lazily, so this measures liveness, not
 * load time. It only has to be longer than a cold fetch of that small script;
 * a worker silent past this is not coming, and a message beats a blank page.
 */
const HELLO_TIMEOUT_MS = 3000;

const WORKER_FAILED = "Yaak's database worker could not be started. Reload the page to try again";

const UNSUPPORTED =
  "This browser can't run Yaak: it needs shared workers and Web Locks to keep your data safe across tabs. Every current browser has both.";

type Pending = { resolve: (value: unknown) => void; reject: (reason: Error) => void };

export class WorkerConnection {
  private port: MessagePort | null;
  private readonly pending = new Map<number, Pending>();
  private readonly listeners = new Map<string, Set<(payload: unknown) => void>>();
  private nextId = 1;
  private bootError: string | null = null;

  /**
   * This tab's identity, standing in for the desktop's window label. Stamped
   * on every write this tab makes, so the store can tell an echo of its own
   * write from another tab's. Minted per page load, not kept in
   * `sessionStorage`, on purpose: duplicating a tab copies session storage,
   * and two tabs claiming one identity would each drop the other's writes as
   * echoes.
   */
  readonly label = `tab_${crypto.randomUUID().slice(0, 8)}`;

  /** True once the worker has said anything at all. */
  private heard = false;

  constructor() {
    // Both are required and neither is faked. Without a shared worker every
    // tab would need its own SQLite over the same pages; without Web Locks
    // nothing can promise there is only one even so. Every current browser,
    // desktop and mobile, has both (Chrome for Android since 148); the ones
    // that don't get told, not corrupted.
    if (typeof SharedWorker === "undefined" || typeof navigator.locks === "undefined") {
      this.port = null;
      this.bootError = UNSUPPORTED;
      showBootError(UNSUPPORTED);
      return;
    }

    this.port = this.connect();

    // Let the worker forget this port. Not load-bearing — a port that never
    // says goodbye is a leaked entry in a Set — but tidy.
    window.addEventListener("pagehide", () => this.post({ type: "goodbye" }));
  }

  /**
   * Connect to the origin's one database worker.
   *
   * The browser hands every tab the same SharedWorker for this name and URL,
   * which is what makes "one database owner" true without anyone coordinating.
   *
   * `new URL("./worker.ts", import.meta.url)` is written out inline on purpose:
   * that exact syntax is what the bundler pattern-matches to know it must
   * bundle a worker entry. Hoisted into a variable it becomes an asset URL and
   * ships as raw TypeScript.
   */
  private connect(): MessagePort {
    const worker = new SharedWorker(new URL("./worker.ts", import.meta.url), {
      type: "module",
      name: WORKER_NAME,
    });
    // A worker whose script fails to load fires `error` on the SharedWorker
    // object and nothing else — the port just goes quiet.
    worker.onerror = () => {
      if (!this.heard) this.failEverything(`${WORKER_FAILED} (its script failed to load).`);
    };
    worker.port.onmessage = (e: MessageEvent<FromWorker>) => this.receive(e.data);
    worker.port.start();

    // The worker says hello synchronously on connect. Silence past the timeout
    // means this port is attached to nothing that will ever answer, and the
    // user should see that rather than a blank page. It is not retried: the
    // one way this used to happen (a module worker missing connects during a
    // top-level-await import) is fixed at the source by importing the wasm
    // lazily, and a reload is the right remedy for anything else.
    setTimeout(() => {
      if (!this.heard) this.failEverything(`${WORKER_FAILED} (it never answered).`);
    }, HELLO_TIMEOUT_MS);

    return worker.port;
  }

  private failEverything(message: string): void {
    this.bootError = message;
    showBootError(message);
    for (const [id, p] of this.pending) {
      this.pending.delete(id);
      p.reject(new Error(message));
    }
  }

  private post(message: ToWorker, transfer: Transferable[] = []): void {
    this.port?.postMessage(message, transfer);
  }

  private receive(message: FromWorker): void {
    this.heard = true;
    switch (message.type) {
      case "hello":
      case "ready":
        return;
      case "boot_error":
        // Nothing will ever answer, and the app cannot render without an
        // answer, so say what happened where the user can see it. This is the
        // page's whole content at this point.
        this.failEverything(message.message);
        return;
      case "result": {
        const p = this.pending.get(message.id);
        this.pending.delete(message.id);
        p?.resolve(message.result);
        return;
      }
      case "error": {
        const p = this.pending.get(message.id);
        this.pending.delete(message.id);
        p?.reject(new Error(message.message));
        return;
      }
      case "event":
        this.deliver(message.event, message.payload);
        return;
    }
  }

  private request<T>(build: (id: number) => ToWorker, transfer: Transferable[] = []): Promise<T> {
    if (this.bootError != null) return Promise.reject(new Error(this.bootError));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.post(build(id), transfer);
    });
  }

  rpc<T>(cmd: string, payload: unknown): Promise<T> {
    return this.request<T>((id) => ({ type: "rpc", id, cmd, payload, label: this.label }));
  }

  /** See `prepare_http_send` in crates/yaak-wasm: the database half of a send. */
  prepareHttpSend<T>(payload: unknown): Promise<T> {
    return this.request<T>((id) => ({ type: "prepare_http_send", id, payload }));
  }

  async blobGet(blobId: string): Promise<Uint8Array<ArrayBuffer> | null> {
    const buf = await this.request<ArrayBuffer | null>((id) => ({ type: "blob_get", id, blobId }));
    return buf == null ? null : new Uint8Array(buf);
  }

  blobPut(blobId: string, bytes: Uint8Array): Promise<void> {
    // Copied so the caller's buffer isn't detached out from under it, then
    // transferred so the copy isn't copied again crossing to the worker.
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    return this.request<void>(
      (id) => ({ type: "blob_put", id, blobId, bytes: copy.buffer }),
      [copy.buffer],
    );
  }

  blobDelete(blobId: string): Promise<void> {
    return this.request<void>((id) => ({ type: "blob_delete", id, blobId }));
  }

  /* ------------------------------- events -------------------------------- */

  listen(event: string, callback: (payload: unknown) => void): Unsubscribe {
    let set = this.listeners.get(event);
    if (set == null) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(callback);
    return () => {
      set.delete(callback);
      if (set.size === 0) this.listeners.delete(event);
    };
  }

  /**
   * Deliver an event to this tab's listeners.
   *
   * Used for what the worker pushes, and for the app's own local emits (a
   * plugin round trip, a stream teardown). Local emits stay local: every
   * emitter in the app is replying to something *this* tab is doing.
   */
  deliver(event: string, payload: unknown): void {
    const set = this.listeners.get(event);
    if (set == null) return;
    // Copied because a listener may unsubscribe itself while being called
    for (const callback of Array.from(set)) {
      try {
        callback(payload);
      } catch (err) {
        console.error(`Listener for \`${event}\` threw`, err);
      }
    }
  }
}

function showBootError(message: string): void {
  const root = document.getElementById("root");
  if (root == null || root.childElementCount > 0) return;
  const el = document.createElement("div");
  el.style.cssText =
    "font: 15px/1.5 system-ui, sans-serif; max-width: 32rem; margin: 20vh auto; padding: 0 1rem; color: inherit";
  el.textContent = message;
  root.appendChild(el);
}
