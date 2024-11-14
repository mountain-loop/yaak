import { useMutation } from '@tanstack/react-query';
import { useToast } from '../components/ToastContext';
import { invokeCmd } from '../lib/tauri';
import { useActiveWorkspace } from './useActiveWorkspace';
import { useCreateHttpRequest } from './useCreateHttpRequest';
import { useRequestUpdateKey } from './useRequestUpdateKey';
import { useUpdateAnyHttpRequest } from './useUpdateAnyHttpRequest';
import type { HttpRequest } from '@yaakapp-internal/models';

export function useImportCurl() {
  const workspace = useActiveWorkspace();
  const updateRequest = useUpdateAnyHttpRequest();
  const createRequest = useCreateHttpRequest();
  const { wasUpdatedExternally } = useRequestUpdateKey(null);
  const toast = useToast();

  return useMutation({
    mutationKey: ['import_curl'],
    mutationFn: async ({
      overwriteRequestId,
      command,
    }: {
      overwriteRequestId?: string;
      command: string;
    }) => {
      const request: HttpRequest = await invokeCmd('cmd_curl_to_request', {
        command,
        workspaceId: workspace?.id,
      });

      let verb;
      if (overwriteRequestId == null) {
        verb = 'Created';
        await createRequest.mutateAsync(request);
      } else {
        verb = 'Updated';
        let update = (r: HttpRequest) => ({
          ...r,
          ...request,
          id: r.id,
          createdAt: r.createdAt,
          workspaceId: r.workspaceId,
          folderId: r.folderId,
          name: r.name,
          sortPriority: r.sortPriority,
        });
        await updateRequest.mutateAsync({ id: overwriteRequestId, update: update });
        setTimeout(() => wasUpdatedExternally(overwriteRequestId), 100);
      }

      toast.show({
        color: 'success',
        message: `${verb} request from Curl`,
      });
    },
  });
}
