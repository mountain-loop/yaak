/**
 * One runtime, one context per module. The engine choice and the limits below
 * are argued in this package's README, which is also the spec for the Rust host.
 */

import variant from "@jitl/quickjs-ng-wasmfile-release-sync";
import {
  newQuickJSWASMModuleFromVariant,
  type QuickJSContext,
  type QuickJSRuntime,
  type QuickJSWASMModule,
} from "quickjs-emscripten-core";
import { GUEST_SOURCE } from "../generated/guest";

const MEMORY_LIMIT_BYTES = 256 * 1024 * 1024;

const STACK_SIZE_BYTES = 2 * 1024 * 1024;

/** Bounds synchronous execution only: a plugin awaiting the host is not looping. */
const SYNC_BUDGET_MS = 60_000;

export type HostRequestHandler = (envelopeJson: string) => Promise<string>;

export interface SandboxLog {
  pluginRefId: string;
  level: string;
  message: string;
}

let modulePromise: Promise<QuickJSWASMModule> | null = null;

function quickjs(): Promise<QuickJSWASMModule> {
  modulePromise ??= newQuickJSWASMModuleFromVariant(variant);
  return modulePromise;
}

class LoadedPlugin {
  readonly pluginRefId: string;
  readonly context: QuickJSContext;
  /** Set while a dispatch is running; the interrupt handler reads it. */
  deadline: number | null = null;
  private nextTimer = new Map<number, ReturnType<typeof setTimeout>>();
  private disposed = false;

  constructor(pluginRefId: string, context: QuickJSContext) {
    this.pluginRefId = pluginRefId;
    this.context = context;
  }

  touch(): void {
    if (this.deadline != null) this.deadline = Date.now() + SYNC_BUDGET_MS;
  }

  startTimer(id: number, ms: number, fire: () => void): void {
    this.nextTimer.set(
      id,
      setTimeout(() => {
        this.nextTimer.delete(id);
        if (!this.disposed) fire();
      }, ms),
    );
  }

  cancelTimer(id: number): void {
    const handle = this.nextTimer.get(id);
    if (handle == null) return;
    clearTimeout(handle);
    this.nextTimer.delete(id);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const handle of this.nextTimer.values()) clearTimeout(handle);
    this.nextTimer.clear();
    this.context.dispose();
  }
}

export class PluginSandboxHost {
  private runtime: QuickJSRuntime | null = null;
  private readonly plugins = new Map<string, LoadedPlugin>();

  constructor(
    private readonly onHostRequest: HostRequestHandler,
    private readonly onLog: (log: SandboxLog) => void,
  ) {}

  async load(pluginRefId: string, source: string): Promise<Record<string, unknown>> {
    const module = await quickjs();

    if (this.runtime == null) {
      this.runtime = module.newRuntime();
      this.runtime.setMemoryLimit(MEMORY_LIMIT_BYTES);
      this.runtime.setMaxStackSize(STACK_SIZE_BYTES);
      this.runtime.setInterruptHandler(() => {
        const now = Date.now();
        for (const plugin of this.plugins.values()) {
          if (plugin.deadline != null && now > plugin.deadline) return true;
        }
        return false;
      });
    }

    this.plugins.get(pluginRefId)?.dispose();

    const plugin = new LoadedPlugin(pluginRefId, this.runtime.newContext());
    this.plugins.set(pluginRefId, plugin);

    try {
      this.installHostFunctions(plugin);
      this.evalOrThrow(plugin, GUEST_SOURCE, "yaak:sandbox-shell");
      await this.callGuest(plugin, "load", [source, pluginRefId]);
      return await this.callGuest(plugin, "summary", []);
    } catch (err) {
      plugin.dispose();
      this.plugins.delete(pluginRefId);
      throw err;
    }
  }

  loaded(): string[] {
    return Array.from(this.plugins.keys());
  }

  unload(pluginRefId: string): void {
    this.plugins.get(pluginRefId)?.dispose();
    this.plugins.delete(pluginRefId);
  }

  async dispatch(pluginRefId: string, envelopeJson: string): Promise<string> {
    const plugin = this.plugins.get(pluginRefId);
    if (plugin == null) throw new Error(`No plugin loaded as \`${pluginRefId}\``);
    const reply = await this.callGuest(plugin, "dispatch", [envelopeJson]);
    return reply as unknown as string;
  }

  dispose(): void {
    for (const plugin of this.plugins.values()) plugin.dispose();
    this.plugins.clear();
    this.runtime?.dispose();
    this.runtime = null;
  }

  /* ------------------------------ internals ------------------------------- */

  private installHostFunctions(plugin: LoadedPlugin): void {
    const { context } = plugin;

    const define = (name: string, fn: Parameters<QuickJSContext["newFunction"]>[1]) => {
      const handle = context.newFunction(name, fn);
      context.setProp(context.global, name, handle);
      handle.dispose();
    };

    define("__yaak_log", (levelHandle, messageHandle) => {
      this.onLog({
        pluginRefId: plugin.pluginRefId,
        level: context.getString(levelHandle),
        message: context.getString(messageHandle),
      });
    });

    define("__yaak_timer_start", (idHandle, msHandle) => {
      const id = context.getNumber(idHandle);
      plugin.startTimer(id, context.getNumber(msHandle), () => {
          plugin.touch();
        this.callGuestSync(plugin, "fireTimer", [id]);
        this.pump(plugin);
      });
    });

    define("__yaak_timer_cancel", (idHandle) => {
      plugin.cancelTimer(context.getNumber(idHandle));
    });

    define("__yaak_call", (envelopeHandle) => {
      const envelope = context.getString(envelopeHandle);

      const wasWatching = plugin.deadline != null;
      plugin.deadline = null;

      const settle = this.onHostRequest(envelope).then(
        (reply) => {
          if (wasWatching) plugin.touch();
          return context.newString(reply);
        },
        (err: unknown) => {
          if (wasWatching) plugin.touch();
          return context.newError(err instanceof Error ? err.message : String(err));
        },
      );

      const deferred = context.newPromise(settle);
      void deferred.settled.then(() => {
        this.pump(plugin);
        deferred.dispose();
      });
      return deferred.handle;
    });
  }

  private pump(plugin: LoadedPlugin): void {
    const result = this.runtime?.executePendingJobs();
    if (result?.error != null) {
      this.onLog({
        pluginRefId: plugin.pluginRefId,
        level: "error",
        message: `Unhandled error in sandbox: ${result.error.consume(
          plugin.context.dump.bind(plugin.context),
        )}`,
      });
    }
  }

  private evalOrThrow(plugin: LoadedPlugin, source: string, filename: string): void {
    plugin.deadline = Date.now() + SYNC_BUDGET_MS;
    try {
      const result = plugin.context.evalCode(source, filename);
      if (result.error != null) {
        throw this.toError(plugin, result.error.consume(plugin.context.dump.bind(plugin.context)));
      }
      result.value.dispose();
    } finally {
      plugin.deadline = null;
    }
  }

  private async callGuest(
    plugin: LoadedPlugin,
    method: string,
    args: (string | number)[],
    // oxlint-disable-next-line no-explicit-any -- the caller knows the guest's shape
  ): Promise<any> {
    const { context } = plugin;
    plugin.deadline = Date.now() + SYNC_BUDGET_MS;

    const guest = context.getProp(context.global, "__yaak_guest");
    const fn = context.getProp(guest, method);
    const argHandles = args.map((a) =>
      typeof a === "string" ? context.newString(a) : context.newNumber(a),
    );

    try {
      const called = context.callFunction(fn, guest, ...argHandles);
      if (called.error != null) {
        throw this.toError(plugin, called.error.consume(context.dump.bind(context)));
      }

      const value = called.value;
      const state = context.getPromiseState(value);
      if (state.type !== "fulfilled" || state.notAPromise !== true) {
        const resolved = context.resolvePromise(value);
        value.dispose();
        this.pump(plugin);
        const settled = await resolved;
        if (settled.error != null) {
          throw this.toError(plugin, settled.error.consume(context.dump.bind(context)));
        }
        return settled.value.consume(context.dump.bind(context));
      }

      return value.consume(context.dump.bind(context));
    } finally {
      plugin.deadline = null;
      for (const handle of argHandles) handle.dispose();
      fn.dispose();
      guest.dispose();
    }
  }

  private callGuestSync(plugin: LoadedPlugin, method: string, args: number[]): void {
    const { context } = plugin;
    const guest = context.getProp(context.global, "__yaak_guest");
    const fn = context.getProp(guest, method);
    const argHandles = args.map((a) => context.newNumber(a));
    try {
      const called = context.callFunction(fn, guest, ...argHandles);
      if (called.error != null) {
        this.onLog({
          pluginRefId: plugin.pluginRefId,
          level: "error",
          message: String(this.toError(plugin, called.error.consume(context.dump.bind(context)))),
        });
      } else {
        called.value.dispose();
      }
    } finally {
      for (const handle of argHandles) handle.dispose();
      fn.dispose();
      guest.dispose();
    }
  }

  private toError(plugin: LoadedPlugin, dumped: unknown): Error {
    if (dumped != null && typeof dumped === "object") {
      const { message, name, stack } = dumped as Record<string, string | undefined>;
      const error = new Error(message ?? JSON.stringify(dumped));
      if (name != null) error.name = name;
      if (stack != null) error.stack = `${name ?? "Error"}: ${message ?? ""}\n${stack}`;
      return error;
    }
    // An interrupted plugin surfaces as `null` with no error object.
    if (dumped == null) {
      return new Error(
        `Plugin \`${plugin.pluginRefId}\` was stopped after running for ` +
          `${SYNC_BUDGET_MS / 1000}s without yielding`,
      );
    }
    return new Error(typeof dumped === "string" ? dumped : JSON.stringify(dumped));
  }
}
