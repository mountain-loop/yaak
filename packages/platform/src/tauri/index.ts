import { getIdentifier } from "@tauri-apps/api/app";
import { Channel, convertFileSrc, invoke } from "@tauri-apps/api/core";
import { emit as tauriEmit, listen as tauriListen } from "@tauri-apps/api/event";
import { basename, resolveResource } from "@tauri-apps/api/path";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { clear, readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readDir, readFile } from "@tauri-apps/plugin-fs";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import { type as osType } from "@tauri-apps/plugin-os";
import type {
  DragDropEvent,
  OpenDialogOptions,
  Platform,
  PlatformCapabilities,
  PlatformWindow,
  RpcPayload,
  Unsubscribe,
} from "../types";

/**
 * The desktop host: the yaak-rpc envelope carried by Tauri's `invoke` and
 * window events.
 *
 * Commands still arrive as their own `invoke` names rather than one `rpc`
 * command, because the Rust side has not moved onto `RpcRouter` yet. When it
 * does, only `rpc` below changes — `invoke("rpc", { cmd, payload })`, the way
 * the proxy app already does it — and no call site notices.
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
  grpc: true,
  websocket: true,
  git: true,
  sync: true,
  tlsOptions: true,
  cookieJar: true,
  localFiles: true,
  timeline: true,
  multiWindow: true,
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
      readFile: (path) => readFile(path),
      readDir: (path) => readDir(path),
      url: (path) => convertFileSrc(path),
      basename: (path) => basename(path),
      resolveResource: (path) => resolveResource(path),
    },

    async rpc<T>(cmd: string, payload?: RpcPayload): Promise<T> {
      try {
        return await invoke<T>(cmd, payload);
      } catch (err) {
        console.warn("Platform command error", cmd, err);
        throw err;
      }
    },

    rpcStream<T, M>(cmd: string, payload: RpcPayload, onMessage: (message: M) => void): Promise<T> {
      const channel = new Channel<M>();
      channel.onmessage = onMessage;
      return invoke<T>(cmd, { ...payload, channel });
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
