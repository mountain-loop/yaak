import type { Folder} from '@yaakapp-internal/models';
import { getModel } from '@yaakapp-internal/models';
import { InlineCode } from '../components/core/InlineCode';
import { showConfirmDelete } from '../lib/confirm';
import { invokeCmd } from '../lib/tauri';
import { useFastMutation } from './useFastMutation';

export function useDeleteFolder(id: string | null) {
  return useFastMutation<Folder | null, string>({
    mutationKey: ['delete_folder', id],
    mutationFn: async () => {
      const folder = getModel('folder', id ?? 'n/a');
      const confirmed = await showConfirmDelete({
        id: 'delete-folder',
        title: 'Delete Folder',
        description: (
          <>
            Permanently delete <InlineCode>{folder?.name}</InlineCode> and everything in it?
          </>
        ),
      });
      if (!confirmed) return null;
      return invokeCmd('cmd_delete_folder', { folderId: id });
    },
  });
}
