/**
 * The browser host: Yaak in a tab, with no install and nothing running locally.
 *
 * The desktop host forwards to a Rust process. This one forwards to a worker
 * running the same model layer compiled to wasm, over a `MessagePort` instead
 * of Tauri's IPC. The worker owns the database and is shared by every tab on
 * the origin, so two tabs stay coherent for the same reason two desktop windows
 * do: one process holds the data and pushes every write to all of them.
 *
 * Sending goes through a small stateless server, because a page cannot see a
 * response the way a desktop app can (see send.ts). What a page genuinely
 * cannot do is not faked: there is no file dialog, no second window, no
 * clipboard read without a prompt. Those report false through `capabilities`
 * and refuse with a reason if called anyway, so a missing feature shows up as a
 * disabled control or a toast that explains itself, never as a silent no-op.
 */

import type {
  DragDropEvent,
  OsType,
  Platform,
  PlatformCapabilities,
  PlatformWindow,
  RpcPayload,
  RpcStreamHandle,
  Unsubscribe,
} from "../types";
import { commandSupport, runCommand } from "./commands";
import { WorkerConnection } from "./connection";
import { unsupported } from "./errors";
import { requestPersistence } from "./storage";

/** What this host can do, reported honestly. */
function capabilitiesFor(): PlatformCapabilities {
  return {
    // Through the Yaak server: the tab renders, the server executes, the tab
    // stores. Requests needing plugin auth or template functions are refused
    // with the reason until plugins run here.
    httpSending: true,
    grpc: false,
    websocket: false,
    git: false,
    sync: false,
    // Certificates and proxies are decided by whoever puts the bytes on the
    // wire, and the Yaak server uses its own.
    tlsOptions: false,
    cookieJar: true,
    localFiles: false,
    // The server streams the engine's events back and the sender stores them.
    timeline: true,
    // Whether the host can put a *second window* on this data on demand — what
    // `cmd_new_child_window` does for Settings and workspace switching. A tab
    // can't, so those open in place instead. This is not a claim that nothing
    // else is looking: other tabs may well be open on the same worker, and it
    // pushes every write to all of them regardless of this flag.
    multiWindow: false,
    // The browser draws the frame around the page. There are no traffic lights
    // to leave room for and no window controls to draw.
    windowChrome: false,
    // The browser already zooms the page, on the same keys, and remembers it
    // per site. The app stays out of the way.
    interfaceZoom: false,
    plugins: false,
    encryption: false,
    updater: false,
    // Reading needs a permission prompt at first paint, which is a bad ask for
    // an app people paste bearer tokens into. Pasting still works everywhere.
    clipboardRead: false,
    systemFonts: false,
    license: false,
  };
}

/** Match `@tauri-apps/plugin-os` spellings so layout code needs no new branch. */
function detectOsType(): OsType {
  const ua = navigator.userAgent;
  if (/Mac|iPhone|iPad|iPod/.test(ua)) return "macos";
  if (/Win/.test(ua)) return "windows";
  if (/Android/.test(ua)) return "android";
  return "linux";
}

/**
 * The Tauri host-plugin commands, which ride outside the RPC envelope.
 *
 * `set_title` has a real browser equivalent. `set_theme` paints the native
 * window frame behind the webview, which a tab has neither of. The license and
 * font plugins answer with "nothing", which is true and keeps the settings
 * screens rendering instead of erroring.
 */
async function hostPluginCommand<T>(cmd: string, payload?: RpcPayload): Promise<T> {
  switch (cmd) {
    case "plugin:yaak-mac-window|set_title": {
      const title = payload?.title;
      document.title = typeof title === "string" ? title : "Yaak";
      return undefined as T;
    }
    case "plugin:yaak-mac-window|set_theme":
      return undefined as T;
    case "plugin:yaak-fonts|list":
      // Enumerating installed fonts is a fingerprinting surface browsers don't
      // offer. The pickers fall back to their bundled families.
      return { editorFonts: [], uiFonts: [] } as T;
    default:
      throw unsupported(cmd, `\`${cmd}\` isn't available when Yaak runs in a browser`);
  }
}

function createWindow(db: WorkerConnection): PlatformWindow {
  const noop = async () => {};

  return {
    // Stands in for the desktop's window label: the identity model writes carry
    // so a tab can tell its own echo from another tab's write.
    label: db.label,

    // A tab manages its own frame. These exist because the interface names
    // them; the UI only reaches for them behind `multiWindow`.
    show: noop,
    close: noop,
    minimize: noop,
    maximize: noop,
    unmaximize: noop,
    isMaximized: async () => false,
    isFullscreen: async () => document.fullscreenElement != null,
    setZoom: noop,

    // Null means "no opinion, let CSS decide". The desktop returns a real value
    // because applying a theme forces the window appearance and poisons the
    // media query; nothing does that here, so `prefers-color-scheme` is the
    // honest answer and the theme package already falls back to it.
    theme: async () => null,

    onThemeChanged(callback) {
      const media = window.matchMedia("(prefers-color-scheme: dark)");
      const listener = () => callback(media.matches ? "dark" : "light");
      media.addEventListener("change", listener);
      return () => media.removeEventListener("change", listener);
    },

    onFocusChanged(callback) {
      const onFocus = () => callback(true);
      const onBlur = () => callback(false);
      window.addEventListener("focus", onFocus);
      window.addEventListener("blur", onBlur);
      return () => {
        window.removeEventListener("focus", onFocus);
        window.removeEventListener("blur", onBlur);
      };
    },

    // Native drag-and-drop reports OS paths, which a page never sees. The DOM's
    // own drag events are a different thing, and the components that need those
    // use them directly.
    onDragDrop(_callback: (event: DragDropEvent) => void): Unsubscribe {
      return () => {};
    },
  };
}

export function createWebPlatform(): Platform {
  const db = new WorkerConnection();
  const capabilities = capabilitiesFor();

  // Without this, IndexedDB is best-effort storage and a browser reclaiming
  // space may drop someone's workspaces. Asking is all we can do, and there is
  // nothing useful to do about a refusal.
  void requestPersistence();

  // Enough to answer "what does this host actually do?" from the console
  // without reading the source.
  (window as unknown as Record<string, unknown>).__YAAK_WEB__ = {
    label: db.label,
    capabilities,
    commands: commandSupport,
  };

  return {
    capabilities,
    window: createWindow(db),

    clipboard: {
      writeText: (text) => navigator.clipboard.writeText(text),
      readText: async () => {
        throw unsupported("clipboard.readText", "Paste instead — Yaak in a browser can't read the clipboard on its own", "clipboardRead");
      },
      clear: async () => {
        throw unsupported("clipboard.clear", "Yaak in a browser can't modify the clipboard", "clipboardRead");
      },
    },

    // Returning null rather than throwing: null is what a cancelled dialog
    // returns, which every caller already handles.
    dialog: {
      open: (async () => null) as Platform["dialog"]["open"],
      save: async () => null,
    },

    files: {
      readDir: async () => {
        throw unsupported("files.readDir", "A browser tab can't browse your filesystem", "localFiles");
      },
      readText: async () => {
        throw unsupported("files.readText", "A browser tab can't read local files", "localFiles");
      },
      // No filesystem here, so a path is just a string this host echoes back.
      url: (path) => path,
      basename: async (path) => path.split(/[/\\]/).pop() ?? path,
      resolveResource: async (path) => path,
    },

    /**
     * Bodies live in the worker's blob database, addressed by the id they were
     * stored under. A page hands over an id and never a location, which is what
     * keeps it from naming bytes the app never wrote.
     */
    blobs: {
      read: (id) => db.blobGet(id),

      async url(id) {
        const bytes = await db.blobGet(id);
        // An object URL, the tab's equivalent of Tauri's `convertFileSrc`. The
        // caller keys a query on it and drops it on the next response, so it is
        // left to be reclaimed when the document goes rather than revoked here
        // while an <img> may still be loading it.
        return bytes == null ? null : URL.createObjectURL(new Blob([bytes]));
      },
    },

    rpc<T>(cmd: string, payload?: RpcPayload): Promise<T> {
      // `plugin:` commands are Tauri host plugins, not engine commands, and
      // never reached the router even on the desktop.
      if (cmd.startsWith("plugin:")) return hostPluginCommand<T>(cmd, payload);
      return runCommand(cmd, payload ?? {}, db) as Promise<T>;
    },

    async rpcStream<T, M>(
      cmd: string,
      payload: RpcPayload,
      onMessage: (message: M) => void,
    ): Promise<RpcStreamHandle<T>> {
      // Same shape as the desktop — subscribe first, then dispatch — so that a
      // command which grows the ability to stream here needs no caller changes.
      const streamId = crypto.randomUUID();
      const unlisten = db.listen(`stream_${streamId}`, (p) => onMessage(p as M));
      try {
        const result = (await runCommand(cmd, { ...payload, streamId }, db)) as T;
        return { result, unlisten };
      } catch (err) {
        unlisten();
        throw err;
      }
    },

    listen<T>(event: string, callback: (payload: T) => void): Unsubscribe {
      return db.listen(event, (payload) => callback(payload as T));
    },

    // Local only. Every emitter in the app is replying to something this tab is
    // doing — a plugin round trip, a stream teardown — and telling other tabs
    // about it would answer a question they never asked.
    emit: async (event, payload) => db.deliver(event, payload),

    openUrl: async (url) => {
      window.open(url, "_blank", "noopener,noreferrer");
    },

    revealItemInDir: async () => {
      throw unsupported("revealItemInDir", "A browser tab can't open your file manager", "localFiles");
    },

    osType: detectOsType,
    appIdentifier: async () => "app.yaak.web",
  };
}
