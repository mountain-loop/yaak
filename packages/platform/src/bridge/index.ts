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
import { BridgeConnection } from "./connection";

/**
 * The browser host: the Yaak UI in a tab, with the real engine running in the
 * Yaak Bridge next to it.
 *
 * Everything the desktop gets from Tauri comes over one HTTP connection
 * instead. The parts a page genuinely cannot do — a native file dialog, a
 * second window, reading the clipboard unprompted — are not faked. They report
 * false through `capabilities` and throw if called anyway, so a missing feature
 * surfaces as a disabled control rather than a silent no-op.
 */

/**
 * Until the bridge answers, assume nothing works.
 *
 * These are replaced wholesale by the server's own report as soon as
 * `/bridge/info` returns, which happens before the app's first render — the
 * boot sequence top-level-awaits a command, and that command cannot resolve
 * before the connection is up. Starting pessimistic means that if that ordering
 * ever changes, the UI hides a feature it should have shown instead of offering
 * one that will fail.
 */
const NO_CAPABILITIES: PlatformCapabilities = {
  grpc: false,
  websocket: false,
  git: false,
  sync: false,
  tlsOptions: false,
  cookieJar: false,
  localFiles: false,
  timeline: false,
  multiWindow: false,
  plugins: false,
  encryption: false,
  updater: false,
  clipboardRead: false,
  systemFonts: false,
  license: false,
};

function unsupported(what: string): Error {
  return new Error(`${what} is not supported in the browser`);
}

/** Match `@tauri-apps/plugin-os` spellings so layout code needs no new branch. */
function detectOsType(): OsType {
  const platform = navigator.userAgent;
  if (/Mac|iPhone|iPad|iPod/.test(platform)) return "macos";
  if (/Win/.test(platform)) return "windows";
  if (/Android/.test(platform)) return "android";
  return "linux";
}

/**
 * A response body path is an opaque handle the backend minted, and the bridge
 * writes them as `<data dir>/responses/<response id>`. Taking the last segment
 * turns it back into the id the `/responses/{id}/body` route wants, which keeps
 * the server from ever being asked for a path chosen by the page.
 */
function responseIdFromBodyPath(path: string): string {
  const segments = path.split(/[/\\]/);
  return segments[segments.length - 1] ?? path;
}

/**
 * Answer the Tauri host-plugin commands, which ride outside the RPC envelope.
 *
 * `set_title` has a real browser equivalent. `set_theme` paints the native
 * window frame behind the webview, which a tab has no equivalent of and does
 * not need. Everything else is a desktop-only feature; rejecting is correct,
 * and the callers already gate on the matching capability.
 */
async function handleHostPluginCommand<T>(cmd: string, payload?: RpcPayload): Promise<T> {
  switch (cmd) {
    case "plugin:yaak-mac-window|set_title": {
      const title = payload?.title;
      document.title = typeof title === "string" ? title : "Yaak";
      return undefined as T;
    }
    case "plugin:yaak-mac-window|set_theme":
      return undefined as T;
    default:
      throw unsupported(`\`${cmd}\``);
  }
}

function createWindow(connection: BridgeConnection): PlatformWindow {
  const noop = async () => {};

  return {
    label: connection.label,

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
    // own drag events are a different thing and the components that need them
    // use them directly.
    onDragDrop(_callback: (event: DragDropEvent) => void): Unsubscribe {
      return () => {};
    },
  };
}

/**
 * Keep the bridge told where the tab is.
 *
 * The desktop reads the workspace, environment, cookie jar and request straight
 * off the window's URL whenever a plugin asks. The bridge can't, so the tab
 * pushes it on every navigation. The router uses the History API, which fires
 * no event of its own on push, hence the wrapping.
 */
function trackNavigation(connection: BridgeConnection): void {
  const report = () => connection.attach();

  for (const method of ["pushState", "replaceState"] as const) {
    const original = history[method];
    history[method] = function (this: History, ...args: Parameters<History["pushState"]>) {
      const result = original.apply(this, args);
      report();
      return result;
    };
  }

  window.addEventListener("popstate", report);
  window.addEventListener("hashchange", report);
}

export function createBridgePlatform(baseUrl: string, token: string | null): Platform {
  const label = `tab_${crypto.randomUUID().slice(0, 8)}`;
  const connection = new BridgeConnection(baseUrl, token, label);

  // Mutated in place once the bridge reports, because `platform.capabilities`
  // hands out this object and callers hold the reference.
  const capabilities: PlatformCapabilities = { ...NO_CAPABILITIES };

  if (connection.hasToken) {
    void connection
      .loadInfo()
      .then((info) => Object.assign(capabilities, info.capabilities))
      .catch((err) => console.error("Failed to read bridge capabilities", err));
  }

  trackNavigation(connection);

  // Two host requests the plugin runtime makes that only a page can carry out.
  connection.listen("bridge_copy_text", (payload) => {
    const text = (payload as { text?: string } | null)?.text;
    if (typeof text === "string") void navigator.clipboard.writeText(text);
  });
  connection.listen("bridge_open_url", (payload) => {
    const url = (payload as { url?: string } | null)?.url;
    if (typeof url === "string") window.open(url, "_blank", "noopener,noreferrer");
  });

  const platformWindow = createWindow(connection);

  return {
    capabilities,
    window: platformWindow,

    clipboard: {
      writeText: (text) => navigator.clipboard.writeText(text),
      // Reading needs a permission prompt the moment the page paints, which is
      // a bad ask for an app people paste bearer tokens into. `clipboardRead`
      // is false and the one caller is gated on it.
      readText: async () => {
        throw unsupported("Reading the clipboard");
      },
      clear: async () => {
        throw unsupported("Clearing the clipboard");
      },
    },

    dialog: {
      open: (async () => null) as Platform["dialog"]["open"],
      save: async () => null,
    },

    files: {
      async readFile(path) {
        const res = await connection.fetch(`/responses/${responseIdFromBodyPath(path)}/body`);
        if (!res.ok) {
          throw new Error(`Failed to read response body (${res.status})`);
        }
        return new Uint8Array(await res.arrayBuffer());
      },

      readDir: async () => {
        throw unsupported("Browsing the filesystem");
      },

      // The `<img src>`/`<video src>` equivalent of Tauri's `convertFileSrc`.
      // The token rides in the query because the browser makes these requests
      // itself and the page cannot add a header to them.
      url: (path) => connection.url(`/responses/${responseIdFromBodyPath(path)}/body`),

      basename: async (path) => path.split(/[/\\]/).pop() ?? path,
      resolveResource: async (path) => path,
    },

    rpc: <T,>(cmd: string, payload?: RpcPayload): Promise<T> => {
      // `plugin:`-prefixed commands are Tauri host plugins, not engine
      // commands, so they never reach the RpcRouter. Two of them are window
      // chrome the tab can do itself; the rest belong to features this host
      // reports false for, and saying so beats a confusing "unknown command".
      if (cmd.startsWith("plugin:")) {
        return handleHostPluginCommand<T>(cmd, payload);
      }
      return connection.rpc<T>(cmd, payload);
    },

    async rpcStream<T, M>(
      cmd: string,
      payload: RpcPayload,
      onMessage: (message: M) => void,
    ): Promise<RpcStreamHandle<T>> {
      // Caller-minted id, subscribed before dispatch, exactly as on the
      // desktop: the command can emit its first message before it returns.
      const streamId = crypto.randomUUID();
      const unlisten = connection.listen(`stream_${streamId}`, (p) => onMessage(p as M));
      try {
        const result = await connection.rpc<T>(cmd, { ...payload, streamId });
        return { result, unlisten };
      } catch (err) {
        unlisten();
        throw err;
      }
    },

    listen: <T,>(event: string, callback: (payload: T) => void): Unsubscribe =>
      connection.listen(event, (payload) => callback(payload as T)),

    emit: async (event, payload) => connection.emit(event, payload),

    openUrl: async (url) => {
      window.open(url, "_blank", "noopener,noreferrer");
    },

    revealItemInDir: async () => {
      throw unsupported("Revealing a file");
    },

    osType: detectOsType,
    appIdentifier: async () => "app.yaak.bridge",
  };
}
