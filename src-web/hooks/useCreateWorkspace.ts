import { useMutation } from './useMutation';
import type { Workspace } from '@yaakapp-internal/models';
import { useSetAtom } from 'jotai/index';
import { invokeCmd } from '../lib/tauri';
import { router } from '../main';
import { Route } from '../routes/workspaces/$workspaceId';
import { usePrompt } from './usePrompt';
import { updateModelList } from './useSyncModelStores';
import { workspacesAtom } from './useWorkspaces';

export function useCreateWorkspace() {
  const prompt = usePrompt();
  const setWorkspaces = useSetAtom(workspacesAtom);

  return useMutation<Workspace | null, void, void>({
    mutationKey: ['create_workspace'],
    mutationFn: async () => {
      const name = await prompt({
        id: 'new-workspace',
        label: 'Name',
        defaultValue: 'My Workspace',
        title: 'New Workspace',
        placeholder: 'My Workspace',
        confirmText: 'Create',
      });
      if (name == null) {
        return null;
      }
      return invokeCmd<Workspace>('cmd_create_workspace', { name });
    },
    onSuccess: async (workspace) => {
      if (workspace == null) return;

      // Optimistic update
      setWorkspaces(updateModelList(workspace));

      router.navigate({
        to: Route.fullPath,
        params: { workspaceId: workspace.id },
      });
    },
  });
}
