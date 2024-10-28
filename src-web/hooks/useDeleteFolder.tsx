import { useMutation } from '@tanstack/react-query';
import type { Folder } from '@yaakapp-internal/models';
import { useSetAtom } from 'jotai';
import { InlineCode } from '../components/core/InlineCode';
import { trackEvent } from '../lib/analytics';
import { getFolder } from '../lib/store';
import { invokeCmd } from '../lib/tauri';
import { useConfirm } from './useConfirm';
import { foldersAtom } from './useFolders';
import { removeModelById } from './useSyncModelStores';

export function useDeleteFolder(id: string | null) {
  const confirm = useConfirm();
  const setFolders = useSetAtom(foldersAtom);

  return useMutation<Folder | null, string>({
    mutationKey: ['delete_folder', id],
    mutationFn: async () => {
      const folder = await getFolder(id);
      const confirmed = await confirm({
        id: 'delete-folder',
        title: 'Delete Folder',
        variant: 'delete',
        description: (
          <>
            Permanently delete <InlineCode>{folder?.name}</InlineCode> and everything in it?
          </>
        ),
      });
      if (!confirmed) return null;
      return invokeCmd('cmd_delete_folder', { folderId: id });
    },
    onSettled: () => trackEvent('folder', 'delete'),
    onSuccess: (folder) => {
      if (folder == null) return;

      setFolders(removeModelById(folder));
    },
  });
}
