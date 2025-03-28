import type { HttpRequest} from '@yaakapp-internal/models';
import { createWorkspaceModel, patchModelById } from '@yaakapp-internal/models';
import { jotaiStore } from '../lib/jotai';
import { invokeCmd } from '../lib/tauri';
import { showToast } from '../lib/toast';
import { activeWorkspaceIdAtom } from './useActiveWorkspace';
import { useFastMutation } from './useFastMutation';
import { wasUpdatedExternally } from './useRequestUpdateKey';

export function useImportCurl() {
  return useFastMutation({
    mutationKey: ['import_curl'],
    mutationFn: async ({
      overwriteRequestId,
      command,
    }: {
      overwriteRequestId?: string;
      command: string;
    }) => {
      const workspaceId = jotaiStore.get(activeWorkspaceIdAtom);
      const importedRequest: HttpRequest = await invokeCmd('cmd_curl_to_request', {
        command,
        workspaceId,
      });

      let verb;
      if (overwriteRequestId == null) {
        verb = 'Created';
        await createWorkspaceModel(importedRequest);
      } else {
        verb = 'Updated';
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
        color: 'success',
        message: `${verb} request from Curl`,
      });
    },
  });
}
