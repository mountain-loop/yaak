/**
 * A tab's handle on its sandbox. `onHostRequest` is the entire answer to "what
 * can a plugin do here?", and this package deliberately has no opinion on it.
 */

import type { FromSandbox, ToSandbox } from "./protocol";


/** Answers one `ctx` call: JSON envelope in, JSON reply out. */
export type HostRequestHandler = (envelope: string) => Promise<string>;

export interface PluginSandboxOptions {
  onHostRequest: HostRequestHandler;
  onLog?: (log: { pluginRefId: string; level: string; message: string }) => void;
}

export interface PluginSummary {
  templateFunctions: string[];
  authentication: string | null;
  importer: boolean;
  filter: boolean;
  themes: number;
  httpRequestActions: number;
  workspaceActions: number;
  folderActions: number;
  grpcRequestActions: number;
  websocketRequestActions: number;
}

type Pending = { resolve: (value: unknown) => void; reject: (reason: Error) => void };

export class PluginSandbox {
  private readonly worker: Worker;
  private readonly pending = new Map<number, Pending>();
  private readonly options: PluginSandboxOptions;
  private nextId = 1;

  constructor(options: PluginSandboxOptions) {
    this.options = options;

    // Written inline because that exact syntax is what the bundler
    // pattern-matches; hoisted into a variable it ships as raw TypeScript.
    this.worker = new Worker(new URL("./worker.ts", import.meta.url), {
      type: "module",
      name: "yaak-plugins",
    });
    this.worker.onmessage = (e: MessageEvent<FromSandbox>) => this.receive(e.data);
    this.worker.onerror = () => this.failEverything("The plugin sandbox failed to start");
  }

  load(pluginRefId: string, source: string): Promise<PluginSummary> {
    return this.request<PluginSummary>((id) => ({ type: "load", id, pluginRefId, source }));
  }

  unload(pluginRefId: string): Promise<void> {
    return this.request<void>((id) => ({ type: "unload", id, pluginRefId }));
  }

  async dispatch<T>(
    pluginRefId: string,
    context: unknown,
    payload: unknown,
  ): Promise<T & { type: string }> {
    const envelope = JSON.stringify({ context, payload });
    const reply = await this.request<string>((id) => ({
      type: "dispatch",
      id,
      pluginRefId,
      envelope,
    }));
    const parsed = JSON.parse(reply) as { type: string; error?: string };
    if (parsed.type === "error_response") {
      throw new Error(parsed.error || "Plugin failed");
    }
    return parsed as T & { type: string };
  }

  /** `terminate()`, not a polite shutdown: the reason to call this is a plugin that won't stop. */
  dispose(): void {
    this.worker.terminate();
    this.failEverything("The plugin sandbox was shut down");
  }

  /* ------------------------------ internals ------------------------------- */

  private request<T>(build: (id: number) => ToSandbox): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.worker.postMessage(build(id));
    });
  }

  private receive(message: FromSandbox): void {
    switch (message.type) {
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
      case "log":
        this.options.onLog?.(message);
        return;
      case "host_call":
        void this.answer(message.id, message.envelope);
        return;
    }
  }

  private async answer(id: number, envelope: string): Promise<void> {
    let reply: ToSandbox;
    try {
      reply = { type: "host_result", id, reply: await this.options.onHostRequest(envelope) };
    } catch (err) {
      reply = {
        type: "host_result",
        id,
        error: err instanceof Error ? err.message : String(err),
      };
    }
    this.worker.postMessage(reply);
  }

  private failEverything(message: string): void {
    for (const [id, p] of this.pending) {
      this.pending.delete(id);
      p.reject(new Error(message));
    }
  }
}
