import type { HttpRequest } from '@yaakapp-internal/models';
import { createModel, patchModelById } from '@yaakapp-internal/models';
import { invokeCmd } from '../lib/tauri';
import { showToast } from '../lib/toast';
import { getActiveWorkspaceId } from './useActiveWorkspace';
import { useFastMutation } from './useFastMutation';
import { useRequestUpdateKey } from './useRequestUpdateKey';

export function useImportCurl() {
  const { wasUpdatedExternally } = useRequestUpdateKey(null);

  return useFastMutation({
    mutationKey: ['import_curl'],
    mutationFn: async ({
      overwriteRequestId,
      command,
    }: {
      overwriteRequestId?: string;
      command: string;
    }) => {
      const workspaceId = getActiveWorkspaceId();
      const importedRequest: HttpRequest = await invokeCmd('cmd_curl_to_request', {
        command,
        workspaceId,
      });

      let verb;
      if (overwriteRequestId == null) {
        verb = 'Created';
        await createModel(importedRequest);
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
