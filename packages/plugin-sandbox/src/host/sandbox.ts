/**
 * The sandbox host: QuickJS, and the four things that cross into it.
 *
 * One QuickJS runtime holds one context per loaded module. A context is the
 * isolation boundary — its own globals, its own `Object`, its own prototypes —
 * so two plugins cannot see or patch each other, and neither can reach the
 * worker's own scope. Sharing a runtime between them is deliberate: the engine
 * and its wasm instance are the expensive part, contexts are not.
 *
 * The engine is `quickjs-ng`, not Bellard's, and the sync variant rather than
 * the ASYNCIFY one. Both choices are recorded in this package's README along
 * with what they cost; the short version is that the Rust host has no choice
 * (rquickjs vendors quickjs-ng and offers no alternative), and the sync build
 * still gives the guest real `await` through a deferred promise, at half the
 * size and twice the speed.
 */

import variant from "@jitl/quickjs-ng-wasmfile-release-sync";
import {
  newQuickJSWASMModuleFromVariant,
  type QuickJSContext,
  type QuickJSRuntime,
  type QuickJSWASMModule,
} from "quickjs-emscripten-core";
import { GUEST_SOURCE } from "../generated/guest";

/**
 * What a module may allocate.
 *
 * Sized for the job rather than for comfort: an importer holding a large spec
 * and the objects it parses into is the high-water mark, and a plugin that
 * wants more than this is doing something a plugin should not. Hitting it
 * throws inside the sandbox and unwinds as an ordinary error.
 */
const MEMORY_LIMIT_BYTES = 256 * 1024 * 1024;

/** Deep recursion is a stack overflow inside the guest, not a crash of the worker. */
const STACK_SIZE_BYTES = 2 * 1024 * 1024;

/**
 * How long a module may run without yielding.
 *
 * This bounds *synchronous* execution only, and it has to: a plugin awaiting
 * the host is not looping, it is waiting for us. So the clock is set when a
 * dispatch begins and pushed back whenever the guest hands control back, which
 * makes it a watchdog for `while (true)` rather than a limit on how long real
 * work may take.
 *
 * Generous, because it costs nothing to be: a plugin runs in its own worker,
 * so one stuck here blocks no database command and no frame. It is sized off
 * the slowest real work measured (`bench/import.mjs`: GitHub's 12 MB OpenAPI
 * description takes about four seconds), with room for a document several
 * times larger before a legitimate import looks like a hang.
 */
const SYNC_BUDGET_MS = 60_000;

export type HostRequestHandler = (envelopeJson: string) => Promise<string>;

export interface SandboxLog {
  pluginRefId: string;
  level: string;
  message: string;
}

let modulePromise: Promise<QuickJSWASMModule> | null = null;

function quickjs(): Promise<QuickJSWASMModule> {
  // Loaded once per worker, on first use. The wasm is ~529 KB and there is no
  // reason to pay for it in a session where nothing calls a plugin.
  modulePromise ??= newQuickJSWASMModuleFromVariant(variant);
  return modulePromise;
}

/** One loaded module, and the context it lives in. */
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

  /** Push the synchronous-execution deadline back; called whenever the guest yields. */
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

  /**
   * Load one module's source under an id.
   *
   * Replaces whatever was loaded under that id, disposing it first, so a
   * reload is a fresh context rather than a re-evaluation on top of the old
   * one's globals.
   */
  async load(pluginRefId: string, source: string): Promise<Record<string, unknown>> {
    const module = await quickjs();

    if (this.runtime == null) {
      this.runtime = module.newRuntime();
      this.runtime.setMemoryLimit(MEMORY_LIMIT_BYTES);
      this.runtime.setMaxStackSize(STACK_SIZE_BYTES);
      // One handler for every context on the runtime. A plugin that is merely
      // waiting has no deadline set, so it is never interrupted.
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

  /** Send one event to one loaded module and wait for its reply payload. */
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
        // Waking a timer re-enters the guest, so it gets a fresh budget.
        plugin.touch();
        this.callGuestSync(plugin, "fireTimer", [id]);
        this.pump(plugin);
      });
    });

    define("__yaak_timer_cancel", (idHandle) => {
      plugin.cancelTimer(context.getNumber(idHandle));
    });

    // The one door out. Everything a plugin does to the world arrives here as
    // a JSON envelope and leaves as a JSON reply; the guest's whole `ctx` is
    // built from this single function.
    define("__yaak_call", (envelopeHandle) => {
      const envelope = context.getString(envelopeHandle);

      // While the host answers, the guest is suspended, not looping — so the
      // watchdog stops until it comes back.
      const wasWatching = plugin.deadline != null;
      plugin.deadline = null;

      const settle = this.onHostRequest(envelope).then(
        (reply) => {
          if (wasWatching) plugin.touch();
          return context.newString(reply);
        },
        (err: unknown) => {
          if (wasWatching) plugin.touch();
          // Rejections come back as an error the guest can catch, which is
          // what a host that cannot answer should look like from inside.
          return context.newError(err instanceof Error ? err.message : String(err));
        },
      );

      const deferred = context.newPromise(settle);
      // Resolving a promise only queues its reactions; something has to run
      // them, and inside a sandbox that something is us.
      void deferred.settled.then(() => {
        this.pump(plugin);
        deferred.dispose();
      });
      return deferred.handle;
    });
  }

  /** Drain the guest's microtask queue. */
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

  /** Call `__yaak_guest.<method>(...args)`, awaiting the result if it is a promise. */
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
        // A promise: hand control back so the guest can make progress, then
        // wait for it on this side.
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

  /** The timer path: fire and forget, because nothing is waiting on it. */
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

  /**
   * A dumped QuickJS error as a host `Error`.
   *
   * The guest's stack is kept in the message: it names lines in the plugin's
   * own bundle, which is the only stack that means anything to whoever wrote
   * it — the worker's own stack would just say "sandbox.ts".
   */
  private toError(plugin: LoadedPlugin, dumped: unknown): Error {
    if (dumped != null && typeof dumped === "object") {
      const { message, name, stack } = dumped as Record<string, string | undefined>;
      const error = new Error(message ?? JSON.stringify(dumped));
      if (name != null) error.name = name;
      if (stack != null) error.stack = `${name ?? "Error"}: ${message ?? ""}\n${stack}`;
      return error;
    }
    // An interrupted plugin surfaces as `null` with no error object at all,
    // which would otherwise read as a mysterious empty failure.
    if (dumped == null) {
      return new Error(
        `Plugin \`${plugin.pluginRefId}\` was stopped after running for ` +
          `${SYNC_BUDGET_MS / 1000}s without yielding`,
      );
    }
    return new Error(typeof dumped === "string" ? dumped : JSON.stringify(dumped));
  }
}
