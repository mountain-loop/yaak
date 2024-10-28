import { useMutation } from '@tanstack/react-query';
import type { Workspace } from '@yaakapp-internal/models';
import {useSetAtom} from "jotai/index";
import { getWorkspace } from '../lib/store';
import { invokeCmd } from '../lib/tauri';
import {updateModelList} from "./useSyncModelStores";
import {workspacesAtom} from "./useWorkspaces";

export function useUpdateWorkspace(id: string | null) {
  const setWorkspaces = useSetAtom(workspacesAtom);
  return useMutation<Workspace, unknown, Partial<Workspace> | ((w: Workspace) => Workspace)>({
    mutationKey: ['update_workspace', id],
    mutationFn: async (v) => {
      const workspace = await getWorkspace(id);
      if (workspace == null) {
        throw new Error("Can't update a null workspace");
      }

      const newWorkspace = typeof v === 'function' ? v(workspace) : { ...workspace, ...v };
      return invokeCmd('cmd_update_workspace', { workspace: newWorkspace });
    },
    onSuccess: async (workspace) => {
      setWorkspaces(updateModelList(workspace));
    },
  });
}
