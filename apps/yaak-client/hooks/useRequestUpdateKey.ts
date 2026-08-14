import { platform } from "@yaakapp-internal/platform";
import type { ModelPayload } from "@yaakapp-internal/models";
import { atom, useAtomValue } from "jotai";
import { generateId } from "../lib/generateId";
import { jotaiStore } from "../lib/jotai";

const requestUpdateKeyAtom = atom<Record<string, string>>({});

platform.listen<ModelPayload[]>("model_writes", (payloads) => {
  const changedIds: string[] = [];
  for (const payload of payloads) {
    if (payload.change.type !== "upsert") continue;

    if (
      (payload.model.model === "http_request" ||
        payload.model.model === "grpc_request" ||
        payload.model.model === "websocket_request") &&
      ((payload.updateSource.type === "window" &&
        payload.updateSource.label !== platform.window.label) ||
        payload.updateSource.type !== "window")
    ) {
      changedIds.push(payload.model.id);
    }
  }
  if (changedIds.length > 0) wasUpdatedExternally(changedIds);
});

export function wasUpdatedExternally(changedRequestIds: string | string[]) {
  const ids = Array.isArray(changedRequestIds) ? changedRequestIds : [changedRequestIds];
  jotaiStore.set(requestUpdateKeyAtom, (m) => {
    const next = { ...m };
    for (const id of ids) next[id] = generateId();
    return next;
  });
}

export function useRequestUpdateKey(requestId: string | null) {
  const keys = useAtomValue(requestUpdateKeyAtom);
  const key = keys[requestId ?? "n/a"];
  return `${requestId}::${key ?? "default"}`;
}
