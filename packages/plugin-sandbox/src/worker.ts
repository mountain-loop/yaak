/// <reference lib="webworker" />

/**
 * The worker plugins run in.
 *
 * A dedicated worker, owned by the tab that made it — deliberately not the
 * SharedWorker that owns the database, for three reasons. Plugin work is slow
 * by design (see `bench/import.mjs`) and the database worker answers every
 * tab's commands synchronously, so a large import in there would stall every
 * other tab's reads. A plugin that never returns can be ended with
 * `terminate()`, which is not something you can do to the worker holding the
 * database. And the capabilities a plugin actually asks for — a prompt, a
 * toast, the active request — belong to a tab rather than to a database, so
 * routing through the tab is the shorter path anyway, not a detour.
 *
 * That leaves the database one hop further away than it would otherwise be:
 * `ctx.store` goes worker → tab → database worker. It is a message either way,
 * and this direction is the one where a stuck plugin costs nothing.
 */

import { PluginSandboxHost } from "./host/sandbox";
import type { FromSandbox, ToSandbox } from "./protocol";

const scope = self as unknown as DedicatedWorkerGlobalScope;

function send(message: FromSandbox): void {
  scope.postMessage(message);
}

/** Host calls waiting on the tab, by id. */
const pendingHostCalls = new Map<number, (reply: string | Error) => void>();
let nextHostCallId = 1;

const host = new PluginSandboxHost(
  (envelope) =>
    new Promise<string>((resolve, reject) => {
      const id = nextHostCallId++;
      pendingHostCalls.set(id, (reply) => (reply instanceof Error ? reject(reply) : resolve(reply)));
      send({ type: "host_call", id, envelope });
    }),
  (log) => send({ type: "log", ...log }),
);

async function handle(message: ToSandbox): Promise<void> {
  if (message.type === "host_result") {
    const settle = pendingHostCalls.get(message.id);
    pendingHostCalls.delete(message.id);
    settle?.(message.error != null ? new Error(message.error) : (message.reply ?? "{}"));
    return;
  }

  try {
    switch (message.type) {
      case "load":
        send({
          type: "result",
          id: message.id,
          result: await host.load(message.pluginRefId, message.source),
        });
        return;
      case "unload":
        host.unload(message.pluginRefId);
        send({ type: "result", id: message.id, result: null });
        return;
      case "dispatch":
        send({
          type: "result",
          id: message.id,
          result: await host.dispatch(message.pluginRefId, message.envelope),
        });
        return;
    }
  } catch (err) {
    send({
      type: "error",
      id: message.id,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

scope.onmessage = (e: MessageEvent<ToSandbox>) => void handle(e.data);
