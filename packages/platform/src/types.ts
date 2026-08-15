/**
 * The complete surface the app is allowed to use to reach its host.
 *
 * Everything the UI needs from outside the page goes through this interface, so
 * that a host other than Tauri (a browser tab talking to the local bridge, a
 * self-hosted or hosted server) can be added by writing one more implementation
 * instead of touching call sites. Nothing outside `src/tauri` may import
 * `@tauri-apps/*` — that is the whole point of the package.
 *
 * Commands and events are the yaak-rpc envelope: a command name plus a JSON
 * payload in, a JSON payload out, and named events pushed the other way. The
 * Tauri host puts that envelope inside `invoke`; a WebSocket host will put it on
 * the wire unchanged.
 */

/** Cancels a subscription. Safe to call more than once. */
export type Unsubscribe = () => void;

/** Matches the values `@tauri-apps/plugin-os` reports so hosts agree on spelling. */
export type OsType =
  | "android"
  | "dragonfly"
  | "freebsd"
  | "ios"
  | "linux"
  | "macos"
  | "netbsd"
  | "openbsd"
  | "solaris"
  | "windows";

export type PlatformAppearance = "light" | "dark";

/** Command arguments. Serialized to JSON, so only JSON values belong here. */
export type RpcPayload = Record<string, unknown>;

/** A streaming command's result, plus the teardown for its subscription. */
export interface RpcStreamHandle<T> {
  result: T;
  unlisten: Unsubscribe;
}

export interface DialogFilter {
  name: string;
  extensions: string[];
}

export interface OpenDialogOptions {
  title?: string;
  defaultPath?: string;
  directory?: boolean;
  multiple?: boolean;
  filters?: DialogFilter[];
}

export interface SaveDialogOptions {
  title?: string;
  defaultPath?: string;
  filters?: DialogFilter[];
}

export interface DirEntry {
  name: string;
  isDirectory: boolean;
  isFile: boolean;
  isSymlink: boolean;
}

export interface DragDropPosition {
  x: number;
  y: number;
}

/**
 * A native drag-and-drop over the window. Distinct from the DOM's drag events:
 * the host reports window coordinates, not a DOM target, so listeners hit-test
 * against their own bounding box.
 */
export type DragDropEvent =
  | { type: "enter"; paths: string[]; position: DragDropPosition }
  | { type: "over"; position: DragDropPosition }
  | { type: "drop"; paths: string[]; position: DragDropPosition }
  | { type: "leave" };

/**
 * The window (desktop) or tab (browser) this UI is running in.
 *
 * Every method a host must provide is named here on purpose. The build spike
 * replaced the Tauri window object wholesale and a single missing method
 * (`onDragDropEvent`) threw mid-render with nothing to catch it at compile time;
 * an explicit interface makes that class of failure a type error instead.
 */
export interface PlatformWindow {
  /**
   * Identity of this window among all the app's windows.
   *
   * Model writes carry the label of the window that made them so the others can
   * tell an echo of their own write from someone else's. A browser host can
   * satisfy this with a per-tab id and a BroadcastChannel.
   */
  readonly label: string;

  show(): Promise<void>;
  close(): Promise<void>;
  minimize(): Promise<void>;
  maximize(): Promise<void>;
  unmaximize(): Promise<void>;
  isMaximized(): Promise<boolean>;
  isFullscreen(): Promise<boolean>;

  /** Scale the whole window's contents. 1 is unscaled. */
  setZoom(scale: number): Promise<void>;

  /** The host's current appearance, or null if it has no opinion and CSS should decide. */
  theme(): Promise<PlatformAppearance | null>;

  onThemeChanged(callback: (appearance: PlatformAppearance) => void): Unsubscribe;
  onFocusChanged(callback: (focused: boolean) => void): Unsubscribe;
  onDragDrop(callback: (event: DragDropEvent) => void): Unsubscribe;
}

export interface PlatformClipboard {
  writeText(text: string): Promise<void>;
  readText(): Promise<string>;
  clear(): Promise<void>;
}

export interface PlatformDialog {
  open(options: OpenDialogOptions & { multiple: true }): Promise<string[] | null>;
  open(options?: OpenDialogOptions): Promise<string | null>;
  save(options?: SaveDialogOptions): Promise<string | null>;
}

/**
 * File-ish operations, keyed by paths the backend handed us.
 *
 * A path here is an opaque handle, not something to parse or construct: the UI
 * only ever passes one back to `url` or `readDir`. A host without a filesystem
 * can mint handles of its own (a blob id, a URL) and stay compatible.
 *
 * Response bodies are addressed by response id instead, because they are the
 * one thing every host stores somewhere different. The desktop reads the file
 * the engine wrote; the bridge fetches it over HTTP. Neither is ever handed a
 * location the page chose.
 */
export interface PlatformFiles {
  readDir(path: string): Promise<DirEntry[]>;

  /** A URL the page can load a file from, for `<img>`, `<video>`, and friends. */
  url(path: string): string;

  basename(path: string): Promise<string>;

  /** Resolve a path bundled with the app itself, rather than one from the backend. */
  resolveResource(path: string): Promise<string>;

  /** The bytes of a stored response body, or null if the response has none. */
  readResponseBody(responseId: string): Promise<Uint8Array<ArrayBuffer> | null>;

  /**
   * A URL the media viewers can point an element at, or null if the response
   * has no stored body.
   *
   * Asynchronous because the host may have to ask the backend where the body
   * is: only the host is allowed to know that, and only the moment before it
   * opens it.
   */
  responseBodyUrl(responseId: string): Promise<string | null>;
}

export interface Platform {
  readonly capabilities: PlatformCapabilities;
  readonly window: PlatformWindow;
  readonly clipboard: PlatformClipboard;
  readonly dialog: PlatformDialog;
  readonly files: PlatformFiles;

  /** Call a backend command and await its result. */
  rpc<T>(cmd: string, payload?: RpcPayload): Promise<T>;

  /**
   * Call a command that streams messages back while it runs.
   *
   * Resolves once the command itself completes, with its result and an
   * `unlisten` that tears down the local subscription. The host guarantees the
   * subscription is live before the command is dispatched, so a stream that
   * emits immediately cannot lose its first message.
   */
  rpcStream<T, M>(
    cmd: string,
    payload: RpcPayload,
    onMessage: (message: M) => void,
  ): Promise<RpcStreamHandle<T>>;

  /** Subscribe to a backend event addressed to this window. */
  listen<T>(event: string, callback: (payload: T) => void): Unsubscribe;

  /** Send an event to the backend. Used for replies and for long-lived streams. */
  emit(event: string, payload?: unknown): Promise<void>;

  openUrl(url: string): Promise<void>;
  revealItemInDir(path: string): Promise<void>;

  /**
   * Which OS the UI is running on. Synchronous because layout decisions
   * (traffic-light padding, modifier key labels) are made during first render.
   */
  osType(): OsType;

  /** The host application's identifier, eg. `app.yaak.desktop`. */
  appIdentifier(): Promise<string>;
}

/**
 * What this host can actually do.
 *
 * Read these instead of testing for a platform: "does this host have a cookie
 * jar" is the real question, and it stays answerable when there are three hosts.
 * The Tauri host hardcodes every capability on; Rust hosts will report theirs
 * from the cargo features they were built with.
 */
export interface PlatformCapabilities {
  /** Send gRPC requests. Needs HTTP/2 trailers, so it needs a real backend. */
  grpc: boolean;
  /** Send WebSocket requests with custom headers and auth. */
  websocket: boolean;
  /** Git-backed workspaces. */
  git: boolean;
  /** Two-way sync between a workspace and a directory of files. */
  sync: boolean;
  /** Client certificates, custom CAs, and disabling certificate validation. */
  tlsOptions: boolean;
  /** A cookie jar the user can read and edit. */
  cookieJar: boolean;
  /** Paths the backend can read: file bodies, proto files, sync directories. */
  localFiles: boolean;
  /** Per-request timing and connection detail. */
  timeline: boolean;
  /** More than one window or tab on the same data. */
  multiWindow: boolean;
  /** The plugin runtime. */
  plugins: boolean;
  /** Workspace encryption backed by a key the host keeps. */
  encryption: boolean;
  /** In-app update checks and installs. */
  updater: boolean;
  /** Reading the clipboard without the user pasting first. */
  clipboardRead: boolean;
  /** Enumerating the fonts installed on the machine. */
  systemFonts: boolean;
  /** Commercial licence activation. */
  license: boolean;
}

export type CapabilityName = keyof PlatformCapabilities;
