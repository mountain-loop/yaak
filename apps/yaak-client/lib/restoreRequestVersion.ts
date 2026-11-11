import { flushAllModelWrites, mergeModelsInStore } from "@yaakapp-internal/models";
import type { AnyModel, ModelVersion } from "@yaakapp-internal/models";
import { wasUpdatedExternally } from "../hooks/useRequestUpdateKey";
import { fireAndForget } from "./fireAndForget";
import { rpc } from "./rpc";
import { showToast } from "./toast";

/**
 * Put an old version's content back into the live request.
 *
 * The backend captures whatever the request currently holds before
 * overwriting it, so this is not a destructive action even when the last edit
 * was never versioned — but the request is still rewritten under the user's
 * cursor, so it is announced.
 */
export function restoreRequestVersion(version: ModelVersion) {
  fireAndForget(
    (async () => {
      await applyRequestVersion(version);
      showToast({
        id: "request-version-restored",
        color: "success",
        message: "Restored the request that produced this response",
      });
    })(),
  );
}

/** The restore itself, in the order the editors need it. */
export async function applyRequestVersion(version: ModelVersion): Promise<void> {
  // The backend restores from the database, so anything still sitting in a
  // debounce has to land first — otherwise it would overwrite the restore
  await flushAllModelWrites();
  const restored = await rpc<AnyModel>("models_restore_request_version", {
    versionId: version.id,
  });
  // Editors re-read from the store when told to, and the change event can
  // arrive after this resolves, so put the restored request there first. The
  // event re-applying it later changes nothing.
  mergeModelsInStore(restored.model, [restored]);
  // The write came from this window, so the store's echo suppression would
  // otherwise leave open editors showing what was there before
  wasUpdatedExternally(restored.id);
}
