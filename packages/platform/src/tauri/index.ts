import { getIdentifier } from "@tauri-apps/api/app";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { emit as tauriEmit, listen as tauriListen } from "@tauri-apps/api/event";
import { basename, resolveResource } from "@tauri-apps/api/path";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { clear, readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readDir, readFile, readTextFile } from "@tauri-apps/plugin-fs";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import { type as osType } from "@tauri-apps/plugin-os";
import type {
  DragDropEvent,
  OpenDialogOptions,
  Platform,
  PlatformCapabilities,
  PlatformWindow,
  RpcPayload,
  RpcStreamHandle,
  Unsubscribe,
} from "../types";

/**
 * The desktop host: the yaak-rpc envelope carried by Tauri's `invoke` and
 * window events. Every command goes through the single `rpc` Tauri command
 * into the `RpcRouter` on the Rust side.
 */

/**
 * Tauri hands back an unsubscribe function asynchronously; the platform hands
 * back one immediately, so callers can unsubscribe from a React cleanup without
 * awaiting. Unsubscribing before the subscription lands is honoured once it does.
 */
function toSyncUnsubscribe(pending: Promise<Unsubscribe>): Unsubscribe {
  let unsubscribe: Unsubscribe | null = null;
  let cancelled = false;

  pending
    .then((fn) => {
      if (cancelled) fn();
      else unsubscribe = fn;
    })
    .catch(console.error);

  return () => {
    cancelled = true;
    unsubscribe?.();
    unsubscribe = null;
  };
}

const ALL_CAPABILITIES: PlatformCapabilities = {
  httpSending: true,
  grpc: true,
  websocket: true,
  git: true,
  sync: true,
  tlsOptions: true,
  cookieJar: true,
  localFiles: true,
  timeline: true,
  multiWindow: true,
  windowChrome: true,
  interfaceZoom: true,
  plugins: true,
  encryption: true,
  updater: true,
  clipboardRead: true,
  systemFonts: true,
  license: true,
};

function createWindow(): PlatformWindow {
  const webview = getCurrentWebviewWindow();

  return {
    label: webview.label,
    show: () => webview.show(),
    close: () => webview.close(),
    minimize: () => webview.minimize(),
    maximize: () => webview.maximize(),
    unmaximize: () => webview.unmaximize(),
    isMaximized: () => webview.isMaximized(),
    isFullscreen: () => webview.isFullscreen(),
    setZoom: (scale) => webview.setZoom(scale),
    theme: () => webview.theme(),
    onThemeChanged: (callback) =>
      toSyncUnsubscribe(webview.onThemeChanged((e) => callback(e.payload))),
    onFocusChanged: (callback) =>
      toSyncUnsubscribe(webview.onFocusChanged((e) => callback(e.payload))),
    onDragDrop: (callback) =>
      toSyncUnsubscribe(webview.onDragDropEvent((e) => callback(e.payload as DragDropEvent))),
  };
}

async function rpc<T>(cmd: string, payload?: RpcPayload): Promise<T> {
  try {
    // Host plugin commands (`plugin:yaak-license|check`, ...) are registered by
    // their Tauri plugins and ride outside the envelope. Everything else goes
    // through the single `rpc` command and the RpcRouter behind it.
    if (cmd.startsWith("plugin:")) {
      return await invoke<T>(cmd, payload);
    }
    return await invoke<T>("rpc", { cmd, payload: payload ?? {} });
  } catch (err) {
    console.warn("Platform command error", cmd, err);
    throw err;
  }
}

/**
 * Where this host keeps the bytes stored under an id, or null if it has none.
 *
 * The desktop stores them as files the engine wrote, so answering means asking
 * the backend. Callers hold ids and nothing else; the path exists for exactly
 * as long as it takes to open the file, which is the one thing a desktop host
 * can do that a tab cannot.
 */
function storedBodyPath(id: string): Promise<string | null> {
  return rpc<string | null>("cmd_http_response_body_path", { responseId: id });
}

export function createTauriPlatform(): Platform {
  const window = createWindow();

  return {
    capabilities: ALL_CAPABILITIES,
    window,

    clipboard: {
      writeText: (text) => writeText(text),
      readText: () => readText(),
      clear: () => clear(),
    },

    dialog: {
      // Overloaded on the interface; one implementation covers both shapes.
      open: ((options?: OpenDialogOptions) => open(options)) as Platform["dialog"]["open"],
      save: (options) => save(options ?? {}),
    },

    files: {
      readDir: (path) => readDir(path),
      readText: (path) => readTextFile(path),
      url: (path) => convertFileSrc(path),
      basename: (path) => basename(path),
      resolveResource: (path) => resolveResource(path),
    },

    blobs: {
      async read(id) {
        const path = await storedBodyPath(id);
        return path == null ? null : readFile(path);
      },

      async url(id) {
        const path = await storedBodyPath(id);
        return path == null ? null : convertFileSrc(path);
      },
    },

    rpc,

    async rpcStream<T, M>(
      cmd: string,
      payload: RpcPayload,
      onMessage: (message: M) => void,
    ): Promise<RpcStreamHandle<T>> {
      // The caller mints the stream id, and the subscription is awaited before
      // the command dispatches: registration is its own IPC round trip, and the
      // command may emit its first message while it runs.
      const streamId = crypto.randomUUID();
      const unlisten = await tauriListen<M>(`stream_${streamId}`, (e) => onMessage(e.payload), {
        target: { kind: "Window", label: window.label },
      });
      try {
        const result = await rpc<T>(cmd, { ...payload, streamId });
        return { result, unlisten };
      } catch (err) {
        unlisten();
        throw err;
      }
    },

    listen<T>(event: string, callback: (payload: T) => void): Unsubscribe {
      return toSyncUnsubscribe(
        tauriListen<T>(event, (e) => callback(e.payload), {
          // Receives events broadcast to every window as well as ones addressed
          // to this one, which is how the backend sends both kinds today.
          target: { kind: "Window", label: window.label },
        }),
      );
    },

    emit: (event, payload) => tauriEmit(event, payload),

    openUrl: (url) => openUrl(url),
    revealItemInDir: (path) => revealItemInDir(path),

    osType: () => osType(),
    appIdentifier: () => getIdentifier(),
  };
}
