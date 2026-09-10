import { flushAllPendingPatches } from "@yaakapp-internal/models";
import type { ModelPayload, ModelVersion, ModelVersionReason } from "@yaakapp-internal/models";
import { platform } from "@yaakapp-internal/platform";
import { EditSessionTracker } from "./editSessionTracker";
import { activeRequestIdAtom } from "../hooks/useActiveRequestId";
import { jotaiStore } from "./jotai";
import { rpc } from "./rpc";

const REQUEST_MODELS = ["http_request", "grpc_request", "websocket_request"];

/**
 * Ask the backend to capture a request's current content.
 *
 * Quiet by design: a version that fails to write is not worth a toast, because
 * every caller below is reacting to the user leaving rather than asking for
 * anything.
 */
export function snapshotRequestVersion(requestId: string, reason: ModelVersionReason) {
  // Edits reach the database on a debounce, so flush before asking for a
  // version of what is in it
  flushAllPendingPatches();
  rpc<ModelVersion>("models_snapshot_request", { requestId, reason }).catch((err: unknown) => {
    console.warn("Failed to snapshot request version", err);
  });
}

export function initRequestVersionSnapshots() {
  const tracker = new EditSessionTracker(snapshotRequestVersion);

  platform.listen<ModelPayload[]>("model_writes", (payloads) => {
    for (const payload of payloads) {
      if (payload.change.type !== "upsert") continue;
      if (!REQUEST_MODELS.includes(payload.model.model)) continue;
      tracker.noteEdit(payload.model.id);
    }
  });

  tracker.noteActiveRequest(jotaiStore.get(activeRequestIdAtom));
  jotaiStore.sub(activeRequestIdAtom, () => {
    tracker.noteActiveRequest(jotaiStore.get(activeRequestIdAtom));
  });

  platform.window.onFocusChanged((focused) => {
    if (!focused) tracker.noteBoundary();
  });

  // Closing is the last boundary there is. Nothing can be awaited here, but the
  // write is already on its way and the backend outlives the window.
  window.addEventListener("beforeunload", () => tracker.noteBoundary());
}
