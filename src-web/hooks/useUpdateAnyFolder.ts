import type { Folder } from '@yaakapp-internal/models';
import { invokeCmd } from '../lib/tauri';
import { useFastMutation } from './useFastMutation';
import { getFolder } from './useFolders';

export function useUpdateAnyFolder() {
  return useFastMutation<Folder, unknown, { id: string; update: (r: Folder) => Folder }>({
    mutationKey: ['update_any_folder'],
    mutationFn: async ({ id, update }) => {
      const folder = getFolder(id);
      if (folder === null) {
        throw new Error("Can't update a null folder");
      }

      return invokeCmd<Folder>('cmd_update_folder', { folder: update(folder) });
    },
  });
}
