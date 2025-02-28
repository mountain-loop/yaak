import type { Folder } from '@yaakapp-internal/models';
import { useSetAtom } from 'jotai';
import { InlineCode } from '../components/core/InlineCode';
import { showConfirmDelete } from '../lib/confirm';
import { invokeCmd } from '../lib/tauri';
import { useFastMutation } from './useFastMutation';
import { foldersAtom, getFolder } from './useFolders';
import { removeModelById } from './useSyncModelStores';

export function useDeleteFolder(id: string | null) {
  const setFolders = useSetAtom(foldersAtom);

  return useFastMutation<Folder | null, string>({
    mutationKey: ['delete_folder', id],
    mutationFn: async () => {
      const folder = getFolder(id);
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
    onSuccess: (folder) => {
      if (folder == null) return;

      setFolders(removeModelById(folder));
    },
  });
}
