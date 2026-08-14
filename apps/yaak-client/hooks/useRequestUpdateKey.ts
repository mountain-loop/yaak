import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { ModelPayload } from "@yaakapp-internal/models";
import { atom, useAtomValue } from "jotai";
import { generateId } from "../lib/generateId";
import { jotaiStore } from "../lib/jotai";

const requestUpdateKeyAtom = atom<Record<string, string>>({});

getCurrentWebviewWindow()
  .listen<ModelPayload[]>("model_writes", ({ payload: payloads }) => {
    const changedIds: string[] = [];
    for (const payload of payloads) {
      if (payload.change.type !== "upsert") continue;

      if (
        (payload.model.model === "http_request" ||
          payload.model.model === "grpc_request" ||
          payload.model.model === "websocket_request") &&
        ((payload.updateSource.type === "window" &&
          payload.updateSource.label !== getCurrentWebviewWindow().label) ||
          payload.updateSource.type !== "window")
      ) {
        changedIds.push(payload.model.id);
      }
    }
    if (changedIds.length > 0) wasUpdatedExternally(changedIds);
  })
  .catch(console.error);

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
