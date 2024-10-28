import { useMutation } from '@tanstack/react-query';
import type { Folder } from '@yaakapp-internal/models';
import { useSetAtom } from 'jotai';
import { trackEvent } from '../lib/analytics';
import { invokeCmd } from '../lib/tauri';
import { useActiveWorkspace } from './useActiveWorkspace';
import { foldersAtom } from './useFolders';
import { usePrompt } from './usePrompt';
import { updateModelList } from './useSyncModelStores';

export function useCreateFolder() {
  const workspace = useActiveWorkspace();
  const prompt = usePrompt();
  const setFolders = useSetAtom(foldersAtom);

  return useMutation<
    Folder | null,
    unknown,
    Partial<Pick<Folder, 'name' | 'sortPriority' | 'folderId'>>
  >({
    mutationKey: ['create_folder'],
    mutationFn: async (patch) => {
      if (workspace === null) {
        throw new Error("Cannot create folder when there's no active workspace");
      }

      if (!patch.name) {
        const name = await prompt({
          id: 'new-folder',
          label: 'Name',
          defaultValue: 'Folder',
          title: 'New Folder',
          confirmText: 'Create',
          placeholder: 'Name',
        });
        if (name == null) return null;

        patch.name = name;
      }

      patch.sortPriority = patch.sortPriority || -Date.now();
      return await invokeCmd('cmd_create_folder', { workspaceId: workspace.id, ...patch });
    },
    onSuccess: (folder) => {
      if (folder == null) return;

      // Optimistic update
      setFolders(updateModelList(folder));
    },
    onSettled: () => trackEvent('folder', 'create'),
  });
}
