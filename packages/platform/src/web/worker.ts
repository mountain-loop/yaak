/// <reference lib="webworker" />

/**
 * The process that owns the database.
 *
 * On the desktop that is the Rust binary: it holds SQLite, every window talks
 * to it, and it pushes model writes to all of them. In a browser this worker
 * plays that part. It loads the model layer compiled to wasm, opens the one
 * database, answers each tab's commands over its port, and fans every
 * `model_writes` out to every port — so two tabs are coherent for the same
 * reason two desktop windows are, not because of a side channel.
 *
 * It runs as a SharedWorker where the browser has one, which is what makes
 * "one database, many tabs" true by construction. Where it doesn't (Android
 * Chrome), it runs as a dedicated worker and takes a Web Lock so a second tab
 * fails to open loudly instead of opening a second SQLite over the same pages.
 */

import { DB_LOCK_NAME, type FromWorker, type ToWorker } from "./protocol";

/**
 * The wasm is imported lazily, inside `boot()`, rather than at the top of the
 * module. That keeps this script's own evaluation instant, so a tab's connect
 * gets its `hello` immediately regardless of how long the model layer takes to
 * download and compile — and the tab can therefore tell "this worker is dead"
 * from "this worker is busy" with a short timeout.
 */
type Engine = typeof import("@yaakapp-internal/web");
let engine: Engine | null = null;

const ports = new Set<MessagePort>();

/** Resolves once `boot()` has, or rejects with why it couldn't. */
let booted: Promise<void> | null = null;
let bootError: string | null = null;

function send(port: MessagePort, message: FromWorker, transfer: Transferable[] = []): void {
  port.postMessage(message, transfer);
}

function broadcast(message: FromWorker): void {
  for (const port of ports) send(port, message);
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/**
 * Open the database, once, for everyone.
 *
 * In a dedicated worker this also takes the lock. `ifAvailable` returns null
 * rather than queueing, because queueing would mean a second tab silently
 * hangs until the first closes — worse than telling it what is going on.
 */
function bootOnce(isShared: boolean): Promise<void> {
  if (booted != null) return booted;

  booted = (async () => {
    if (!isShared) {
      if (typeof navigator.locks === "undefined") {
        // No way to guarantee exclusivity; proceed and hope. This is old
        // browsers only, and they will get one tab working.
        const loaded = await import("@yaakapp-internal/web");
        await loaded.boot();
        engine = loaded;
        return;
      }
      const held = await new Promise<boolean>((resolve) => {
        void navigator.locks.request(DB_LOCK_NAME, { ifAvailable: true }, (lock) => {
          if (lock == null) {
            resolve(false);
            return;
          }
          resolve(true);
          // Hold the lock for as long as this worker lives
          return new Promise<void>(() => {});
        });
      });
      if (!held) {
        throw new Error(
          "Yaak is already open in another tab, and this browser can't share a database between tabs. Close the other tab, or use it instead.",
        );
      }
    }
    const loaded = await import("@yaakapp-internal/web");
    await loaded.boot();
    engine = loaded;
  })();

  booted.catch((err) => {
    bootError = errorMessage(err);
  });

  return booted;
}

async function handle(port: MessagePort, message: ToWorker): Promise<void> {
  if (message.type === "goodbye") {
    ports.delete(port);
    return;
  }

  // Every command waits for boot rather than the tab having to. Tabs post
  // the moment they load; the port queues; this drains once the DB is open.
  try {
    await booted;
  } catch {
    send(port, { type: "error", id: message.id, message: bootError ?? "Database failed to open" });
    return;
  }
  const { rpc, blob_get, blob_put, blob_delete } = engine!;

  try {
    switch (message.type) {
      case "rpc": {
        const outcome = rpc(message.cmd, message.payload, message.label) as {
          result: unknown;
          events: unknown[];
        };
        // Result first, to the caller; then the writes, to everyone including
        // the caller. The store applies its own echo the same as any other
        // window's, so it must arrive — and the caller's `await` resolving
        // before its echo lands is fine, because it resolves on the same tick
        // and the store reads on the next.
        send(port, { type: "result", id: message.id, result: outcome.result });
        if (outcome.events.length > 0) {
          broadcast({ type: "event", event: "model_writes", payload: outcome.events });
        }
        return;
      }
      case "blob_get": {
        const bytes = blob_get(message.blobId);
        if (bytes == null) {
          send(port, { type: "result", id: message.id, result: null });
        } else {
          // Copy into a fresh buffer we can transfer: the wasm's memory
          // cannot leave the worker.
          const out = new Uint8Array(bytes.byteLength);
          out.set(bytes);
          send(port, { type: "result", id: message.id, result: out.buffer }, [out.buffer]);
        }
        return;
      }
      case "blob_put": {
        blob_put(message.blobId, new Uint8Array(message.bytes));
        send(port, { type: "result", id: message.id, result: null });
        return;
      }
      case "blob_delete": {
        blob_delete(message.blobId);
        send(port, { type: "result", id: message.id, result: null });
        return;
      }
    }
  } catch (err) {
    send(port, { type: "error", id: message.id, message: errorMessage(err) });
  }
}

function attach(port: MessagePort, isShared: boolean): void {
  ports.add(port);
  port.onmessage = (e: MessageEvent<ToWorker>) => void handle(port, e.data);
  port.start?.();

  // Proof of life, before boot: the tab is timing this.
  send(port, { type: "hello" });

  bootOnce(isShared).then(
    () => send(port, { type: "ready" }),
    (err) => send(port, { type: "boot_error", message: errorMessage(err) }),
  );
}

// A SharedWorker sees each tab arrive as a connect event; a dedicated worker
// *is* its one tab's port.
const scope = self as unknown as { onconnect?: unknown };
if ("onconnect" in scope) {
  (self as unknown as SharedWorkerGlobalScope).onconnect = (e: MessageEvent) => {
    attach(e.ports[0]!, true);
  };
} else {
  attach(self as unknown as MessagePort, false);
}
