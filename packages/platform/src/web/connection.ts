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
 * load time. The one thing that can push it past this is a slow first fetch of
 * the script itself, and the cost of a false alarm there is a second connect
 * that the browser resolves to the same, now-live worker. The cost of guessing
 * high is a user staring at a blank page, so err low.
 */
const HELLO_TIMEOUT_MS = 400;
/** Shared-worker connects to try before settling for a dedicated worker. */
const MAX_SHARED_ATTEMPTS = 3;

type Pending = {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  /** Kept so the request can be re-sent if the worker has to be replaced. */
  message: ToWorker;
  transfer: Transferable[];
};

export class WorkerConnection {
  private port: MessagePort | Worker;
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

  /** Whether the database is shared with other tabs, or this tab holds it alone. */
  shared: boolean;

  /** True once the worker has said anything at all; after that, no fallback. */
  private heard = false;

  /** How many times a shared worker was tried before giving up on sharing. */
  private sharedAttempts = 0;

  constructor() {
    if (typeof SharedWorker !== "undefined") {
      this.port = this.connectShared();
      this.shared = true;
    } else {
      // No SharedWorker (Android Chrome). One tab owns the database; the
      // worker takes a lock and a second tab is told so.
      this.port = this.connectDedicated();
      this.shared = false;
    }

    // Let the worker forget this port. Not load-bearing — a SharedWorker port
    // that never says goodbye is a leaked entry in a Set — but tidy.
    window.addEventListener("pagehide", () => this.post({ type: "goodbye" }));
  }

  /*
   * `new URL("./worker.ts", import.meta.url)` is written out inline at each
   * constructor on purpose: that exact syntax is what the bundler pattern-
   * matches to know it must bundle a worker entry. Hoisted into a variable it
   * becomes an asset URL and ships as raw TypeScript.
   */

  private connectShared(): MessagePort {
    this.sharedAttempts += 1;
    const worker = new SharedWorker(new URL("./worker.ts", import.meta.url), {
      type: "module",
      name: WORKER_NAME,
    });
    // A SharedWorker whose script fails to load fires `error` on the
    // SharedWorker object and nothing else — the port just goes quiet. Some
    // embedded browsers can't fetch shared-worker scripts at all.
    worker.onerror = () => {
      if (!this.heard) this.replaceWorker("script failed to load");
    };
    this.attach(worker.port);
    this.expectHello(worker.port);
    return worker.port;
  }

  private connectDedicated(): Worker {
    const worker = new Worker(new URL("./worker.ts", import.meta.url), {
      type: "module",
      name: WORKER_NAME,
    });
    this.attach(worker);
    this.expectHello(worker);
    return worker;
  }

  private attach(port: MessagePort | Worker): void {
    this.heard = false;
    port.onmessage = (e: MessageEvent<FromWorker>) => this.receive(e.data);
    if (port instanceof MessagePort) port.start();
  }

  /**
   * The worker says hello synchronously on connect. If it doesn't, the port is
   * attached to nothing that will ever answer — most often a shared worker
   * caught mid-teardown, which is what a tab reloading itself hands to the
   * next document — and the only move is to connect again.
   */
  private expectHello(port: MessagePort | Worker): void {
    // Passed in rather than read from `this.port`, which the constructor has
    // not assigned yet the first time this runs.
    setTimeout(() => {
      if (!this.heard && this.port === port) this.replaceWorker("no reply from worker");
    }, HELLO_TIMEOUT_MS);
  }

  /**
   * Replace a worker that never answered. Tries sharing again a few times —
   * a torn-down shared worker is gone by then and a fresh one comes up — and
   * only then gives up on sharing and takes a dedicated worker.
   */
  private replaceWorker(why: string): void {
    if (this.sharedAttempts < MAX_SHARED_ATTEMPTS) {
      console.warn(`Reconnecting to the database worker (${why})`);
      this.port = this.connectShared();
      this.shared = true;
    } else {
      console.warn(`Falling back to a dedicated database worker (${why})`);
      this.port = this.connectDedicated();
      this.shared = false;
    }
    // Whatever was posted to the dead port never arrived. Bodies were copied,
    // not transferred, precisely so they can be re-sent from here.
    for (const p of this.pending.values()) {
      this.post(p.message, p.transfer);
    }
  }

  private post(message: ToWorker, transfer: Transferable[] = []): void {
    this.port.postMessage(message, transfer);
  }

  private receive(message: FromWorker): void {
    this.heard = true;
    switch (message.type) {
      case "hello":
      case "ready":
        return;
      case "boot_error":
        this.bootError = message.message;
        // Nothing will ever answer, and the app cannot render without an
        // answer, so say what happened where the user can see it. This is the
        // page's whole content at this point.
        showBootError(message.message);
        for (const [id, p] of this.pending) {
          this.pending.delete(id);
          p.reject(new Error(message.message));
        }
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
    const message = build(id);
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, message, transfer });
      this.post(message, transfer);
    });
  }

  rpc<T>(cmd: string, payload: unknown): Promise<T> {
    return this.request<T>((id) => ({ type: "rpc", id, cmd, payload, label: this.label }));
  }

  async blobGet(blobId: string): Promise<Uint8Array<ArrayBuffer> | null> {
    const buf = await this.request<ArrayBuffer | null>((id) => ({ type: "blob_get", id, blobId }));
    return buf == null ? null : new Uint8Array(buf);
  }

  blobPut(blobId: string, bytes: Uint8Array): Promise<void> {
    // Copied rather than transferred: transferring would detach the caller's
    // buffer, and would leave nothing to re-send if the worker is replaced.
    // Bodies are small enough that the copy is cheaper than the bookkeeping.
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    return this.request<void>((id) => ({ type: "blob_put", id, blobId, bytes: copy.buffer }));
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
