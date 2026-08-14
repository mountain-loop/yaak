import type { Unsubscribe } from "../types";

/**
 * The wire to the Yaak Bridge: one `POST /rpc` per command, one WebSocket for
 * events in both directions.
 *
 * The hard requirement this file exists to satisfy: the connection is opened
 * asynchronously, but the host that uses it must be constructible
 * *synchronously*. Boot-time modules call commands while the module graph is
 * still evaluating (`lib/appInfo.ts` top-level-awaits one), so there is no
 * later moment to install a host, and a registry that waited for a socket would
 * deadlock. So every call made before the connection opens is queued here and
 * flushed when it does. The app's own top-level await then doubles as the
 * connection gate: nothing renders until the first command has answered, which
 * means it has answered over a live connection.
 */

interface EventFrame {
  event: string;
  payload: unknown;
}

export interface BridgeInfo {
  name: string;
  version: string;
  capabilities: Record<string, boolean>;
  commands: string[];
}

/** How long to wait before retrying a dropped connection, and the ceiling. */
const RECONNECT_BASE_MS = 250;
const RECONNECT_MAX_MS = 5000;

export class BridgeConnection {
  readonly baseUrl: string;
  readonly label: string;
  /**
   * Null when the user hasn't supplied one yet. The connection then never
   * opens, so every call queues forever — which is exactly what the connect
   * screen wants, and means "waiting for a token" and "waiting for the socket"
   * are the same code path rather than two.
   */
  private readonly token: string | null;

  private socket: WebSocket | null = null;
  private connected = false;
  private reconnectDelay = RECONNECT_BASE_MS;

  /** Frames the page tried to send before the socket opened. */
  private outboundQueue: EventFrame[] = [];
  /** Resolvers for anything awaiting the first successful connection. */
  private readyWaiters: Array<() => void> = [];
  private listeners = new Map<string, Set<(payload: unknown) => void>>();

  info: BridgeInfo | null = null;

  constructor(baseUrl: string, token: string | null, label: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.token = token;
    this.label = label;
    if (token != null) this.openSocket();
  }

  get hasToken(): boolean {
    return this.token != null;
  }

  /** Resolves once the events socket is open. */
  ready(): Promise<void> {
    if (this.connected) return Promise.resolve();
    return new Promise((resolve) => this.readyWaiters.push(resolve));
  }

  /** A URL on the bridge with the token attached, for the browser to fetch directly. */
  url(path: string): string {
    const url = new URL(this.baseUrl + path);
    url.searchParams.set("token", this.token ?? "");
    return url.toString();
  }

  async fetch(path: string, init?: RequestInit): Promise<Response> {
    const headers = new Headers(init?.headers);
    headers.set("Authorization", `Bearer ${this.token ?? ""}`);
    return fetch(this.baseUrl + path, { ...init, headers });
  }

  async loadInfo(): Promise<BridgeInfo> {
    const res = await this.fetch("/bridge/info");
    if (!res.ok) {
      throw new Error(`Bridge rejected the connection (${res.status}). Is the token correct?`);
    }
    this.info = (await res.json()) as BridgeInfo;
    return this.info;
  }

  /**
   * Send a command and await its result.
   *
   * Waits for the connection first, so a command issued during module
   * evaluation queues instead of failing. Errors are carried inside the
   * envelope and rethrown here, so callers see the backend's own message —
   * matching what Tauri's `invoke` does with a rejected command.
   */
  async rpc<T>(cmd: string, payload: Record<string, unknown> = {}): Promise<T> {
    await this.ready();

    const res = await this.fetch("/rpc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: crypto.randomUUID(), cmd, payload }),
    });

    if (!res.ok) {
      throw new Error(`Bridge request failed (${res.status})`);
    }

    const body = (await res.json()) as
      | { type: "Success"; id: string; payload: T }
      | { type: "Error"; id: string; error: string };

    if (body.type === "Error") {
      throw new Error(body.error);
    }
    return body.payload;
  }

  listen(event: string, callback: (payload: unknown) => void): Unsubscribe {
    let handlers = this.listeners.get(event);
    if (handlers == null) {
      handlers = new Set();
      this.listeners.set(event, handlers);
    }
    handlers.add(callback);

    // Synchronous, because callers unsubscribe from React cleanups.
    return () => {
      const current = this.listeners.get(event);
      if (current == null) return;
      current.delete(callback);
      if (current.size === 0) this.listeners.delete(event);
    };
  }

  emit(event: string, payload: unknown): void {
    const frame: EventFrame = { event, payload };
    if (this.socket != null && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(frame));
    } else {
      this.outboundQueue.push(frame);
    }
  }

  /** Tell the bridge who and where we are — what a desktop window's URL says. */
  attach(): void {
    this.emit("bridge_attach", { label: this.label, url: window.location.href });
  }

  private openSocket(): void {
    const wsUrl = new URL(this.baseUrl.replace(/^http/, "ws") + "/events");
    wsUrl.searchParams.set("token", this.token ?? "");

    const socket = new WebSocket(wsUrl.toString());
    this.socket = socket;

    socket.onopen = () => {
      this.connected = true;
      this.reconnectDelay = RECONNECT_BASE_MS;
      this.attach();

      for (const frame of this.outboundQueue.splice(0)) {
        socket.send(JSON.stringify(frame));
      }
      for (const resolve of this.readyWaiters.splice(0)) {
        resolve();
      }
    };

    socket.onmessage = (message) => {
      let frame: EventFrame;
      try {
        frame = JSON.parse(String(message.data)) as EventFrame;
      } catch {
        console.warn("Bridge sent a malformed event frame");
        return;
      }
      // Deliver the payload directly, not wrapped in Tauri's `{ payload }`.
      for (const handler of this.listeners.get(frame.event) ?? []) {
        try {
          handler(frame.payload);
        } catch (err) {
          console.error("Bridge event handler threw", frame.event, err);
        }
      }
    };

    socket.onclose = () => {
      this.connected = false;
      this.socket = null;
      // The server closes the socket when a tab falls too far behind to be
      // consistent, so a reconnect has to re-read the workspace rather than
      // resume. `bridge_reconnected` is what tells the app to do that.
      window.setTimeout(() => this.openSocket(), this.reconnectDelay);
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_MS);
    };

    socket.onerror = () => {
      // `onclose` always follows, and it owns the retry.
      socket.close();
    };
  }
}
