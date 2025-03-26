import { patchModel } from '@yaakapp-internal/models';
import { InlineCode } from '../components/core/InlineCode';
import { showPrompt } from '../lib/prompt';
import { useFastMutation } from './useFastMutation';
import { useRequests } from './useRequests';

export function useRenameRequest(requestId: string | null) {
  const requests = useRequests();

  return useFastMutation({
    mutationKey: ['rename_request'],
    mutationFn: async () => {
      const request = requests.find((r) => r.id === requestId);
      if (request == null) return;

      const name = await showPrompt({
        id: 'rename-request',
        title: 'Rename Request',
        description:
          request.name === '' ? (
            'Enter a new name'
          ) : (
            <>
              Enter a new name for <InlineCode>{request.name}</InlineCode>
            </>
          ),
        label: 'Name',
        placeholder: 'New Name',
        defaultValue: request.name,
        confirmText: 'Save',
      });

      if (name == null) return;

      await patchModel(request, { name });
    },
  });
}
