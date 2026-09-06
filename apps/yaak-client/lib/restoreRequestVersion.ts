import { flushAllModelWrites } from "@yaakapp-internal/models";
import type { ModelVersion } from "@yaakapp-internal/models";
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
      // The backend restores from the database, so anything still sitting in a
      // debounce has to land first — otherwise it would overwrite the restore
      await flushAllModelWrites();
      const requestId = await rpc<string>("models_restore_request_version", {
        versionId: version.id,
      });
      // The write came from this window, so the store's echo suppression would
      // otherwise leave open editors showing what was there before
      wasUpdatedExternally(requestId);
      showToast({
        id: "request-version-restored",
        color: "success",
        message: "Restored the request that produced this response",
      });
    })(),
  );
}
