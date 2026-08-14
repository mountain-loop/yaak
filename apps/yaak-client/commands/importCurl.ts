import type { HttpRequest } from "@yaakapp-internal/models";
import { patchModelById } from "@yaakapp-internal/models";
import { activeWorkspaceIdAtom } from "../hooks/useActiveWorkspace";
import { createFastMutation } from "../hooks/useFastMutation";
import { wasUpdatedExternally } from "../hooks/useRequestUpdateKey";
import { createRequestAndNavigate } from "../lib/createRequestAndNavigate";
import { jotaiStore } from "../lib/jotai";
import { rpc } from "../lib/rpc";
import { showToast } from "../lib/toast";

export function looksLikeCurl(text: string) {
  return text.trim().startsWith("curl ");
}

export const importCurl = createFastMutation<
  void,
  string,
  { overwriteRequestId?: string; command: string }
>({
  mutationKey: ["import_curl"],
  mutationFn: async ({ overwriteRequestId, command }) => {
    const workspaceId = jotaiStore.get(activeWorkspaceIdAtom);
    const importedRequest: HttpRequest = await rpc("cmd_curl_to_request", {
      command,
      workspaceId,
    });

    let verb: string;
    if (overwriteRequestId == null) {
      verb = "Created";
      await createRequestAndNavigate(importedRequest);
    } else {
      verb = "Updated";
      await patchModelById(importedRequest.model, overwriteRequestId, (r: HttpRequest) => ({
        ...importedRequest,
        id: r.id,
        createdAt: r.createdAt,
        workspaceId: r.workspaceId,
        folderId: r.folderId,
        name: r.name,
        sortPriority: r.sortPriority,
      }));

      setTimeout(() => wasUpdatedExternally(overwriteRequestId), 100);
    }

    showToast({
      color: "success",
      message: `${verb} request from Curl`,
    });
  },
});
