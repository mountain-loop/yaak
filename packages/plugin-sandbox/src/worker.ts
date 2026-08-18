/// <reference lib="webworker" />

/**
 * A dedicated worker owned by the tab, deliberately not the SharedWorker that
 * owns the database. Reasons and the cost are in the README.
 */

import { PluginSandboxHost } from "./host/sandbox";
import type { FromSandbox, ToSandbox } from "./protocol";

const scope = self as unknown as DedicatedWorkerGlobalScope;

function send(message: FromSandbox): void {
  scope.postMessage(message);
}

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
