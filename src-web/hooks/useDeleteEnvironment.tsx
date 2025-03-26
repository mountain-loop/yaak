import type { Environment } from '@yaakapp-internal/models';
import { InlineCode } from '../components/core/InlineCode';
import { showConfirmDelete } from '../lib/confirm';
import { invokeCmd } from '../lib/tauri';
import { useFastMutation } from './useFastMutation';

export function useDeleteEnvironment(environment: Environment | null) {
  return useFastMutation<Environment | null, string>({
    mutationKey: ['delete_environment', environment?.id],
    mutationFn: async () => {
      const confirmed = await showConfirmDelete({
        id: 'delete-environment',
        title: 'Delete Environment',
        description: (
          <>
            Permanently delete <InlineCode>{environment?.name}</InlineCode>?
          </>
        ),
      });
      if (!confirmed) return null;
      return invokeCmd('cmd_delete_environment', { environmentId: environment?.id });
    },
  });
}
