import type { HttpRequest } from '@yaakapp-internal/models';
import { invokeCmd } from '../lib/tauri';
import { getActiveWorkspaceId } from './useActiveWorkspace';
import { useCreateHttpRequest } from './useCreateHttpRequest';
import { useFastMutation } from './useFastMutation';
import { useRequestUpdateKey } from './useRequestUpdateKey';
import { showToast } from '../lib/toast';
import { useUpdateAnyHttpRequest } from './useUpdateAnyHttpRequest';

export function useImportCurl() {
  const updateRequest = useUpdateAnyHttpRequest();
  const createRequest = useCreateHttpRequest();
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
      const request: HttpRequest = await invokeCmd('cmd_curl_to_request', {
        command,
        workspaceId,
      });

      let verb;
      if (overwriteRequestId == null) {
        verb = 'Created';
        await createRequest.mutateAsync(request);
      } else {
        verb = 'Updated';
        await updateRequest.mutateAsync({
          id: overwriteRequestId,
          update: (r: HttpRequest) => ({
            ...request,
            id: r.id,
            createdAt: r.createdAt,
            workspaceId: r.workspaceId,
            folderId: r.folderId,
            name: r.name,
            sortPriority: r.sortPriority,
          }),
        });

        setTimeout(() => wasUpdatedExternally(overwriteRequestId), 100);
      }

      showToast({
        color: 'success',
        message: `${verb} request from Curl`,
      });
    },
  });
}
