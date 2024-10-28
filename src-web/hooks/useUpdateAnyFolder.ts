import { useMutation } from '@tanstack/react-query';
import type { Folder } from '@yaakapp-internal/models';
import {useSetAtom} from "jotai/index";
import { getFolder } from '../lib/store';
import { invokeCmd } from '../lib/tauri';
import {foldersAtom} from "./useFolders";
import {updateModelList} from "./useSyncModelStores";

export function useUpdateAnyFolder() {
  const setFolders = useSetAtom(foldersAtom);
  return useMutation<Folder, unknown, { id: string; update: (r: Folder) => Folder }>({
    mutationKey: ['update_any_folder'],
    mutationFn: async ({ id, update }) => {
      const folder = await getFolder(id);
      if (folder === null) {
        throw new Error("Can't update a null folder");
      }

      return invokeCmd<Folder>('cmd_update_folder', { folder: update(folder) });
    },
    onSuccess: async (folder) => {
      setFolders(updateModelList(folder));
    }
  });
}
