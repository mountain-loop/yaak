import type { Platform } from "./types";

let installed: Platform | null = null;

/**
 * Install the host implementation. Called once at import time by this package's
 * entry point, before any consumer's module body runs.
 *
 * It stays swappable at runtime because a browser build has to choose between
 * talking to a local bridge and running in-page, and it can only find out which
 * after it has tried to reach the bridge.
 */
export function setPlatform(next: Platform): void {
  installed = next;
}

function host(): Platform {
  if (installed == null) {
    throw new Error("No platform installed. Import @yaakapp-internal/platform before using it.");
  }
  return installed;
}

/**
 * The host, for everyone else to use.
 *
 * This is a fixed object that forwards to whatever is installed, so modules can
 * import it at any time — including at module scope, which several boot-time
 * modules do — without capturing a stale implementation.
 *
 * A host that has to connect before it can work (a WebSocket to the bridge)
 * buffers inside its own `rpc`; nothing here waits on a connection, because the
 * app's boot sequence calls commands while the module graph is still evaluating
 * and cannot be made to wait.
 */
export const platform: Platform = {
  get capabilities() {
    return host().capabilities;
  },
  get window() {
    return host().window;
  },
  get clipboard() {
    return host().clipboard;
  },
  get dialog() {
    return host().dialog;
  },
  get files() {
    return host().files;
  },
  get blobs() {
    return host().blobs;
  },
  rpc: (cmd, payload) => host().rpc(cmd, payload),
  rpcStream: (cmd, payload, onMessage) => host().rpcStream(cmd, payload, onMessage),
  listen: (event, callback) => host().listen(event, callback),
  emit: (event, payload) => host().emit(event, payload),
  openUrl: (url) => host().openUrl(url),
  revealItemInDir: (path) => host().revealItemInDir(path),
  osType: () => host().osType(),
  appIdentifier: () => host().appIdentifier(),
};
