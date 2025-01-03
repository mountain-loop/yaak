import { useNavigate } from '@tanstack/react-router';
import type { Folder, Workspace } from '@yaakapp-internal/models';
import { useMemo } from 'react';
import { trackEvent } from '../lib/analytics';
import { jotaiStore } from '../lib/jotai';
import { invokeCmd } from '../lib/tauri';
import { getActiveWorkspaceId } from './useActiveWorkspace';
import { createFastMutation } from './useFastMutation';
import { foldersAtom } from './useFolders';
import { usePrompt } from './usePrompt';
import { updateModelList } from './useSyncModelStores';
import { useToast } from './useToast';
import { workspacesAtom } from './useWorkspaces';

function makeCommands({
  navigate,
  prompt,
}: {
  navigate: ReturnType<typeof useNavigate>;
  prompt: ReturnType<typeof usePrompt>;
  toast: ReturnType<typeof useToast>;
}) {
  return {
    createWorkspace: createFastMutation<Workspace, void, Partial<Workspace>>({
      mutationKey: ['create_workspace'],
      mutationFn: (patch) => invokeCmd<Workspace>('cmd_update_workspace', { workspace: patch }),
      onSuccess: async (workspace) => {
        // Optimistic update
        jotaiStore.set(workspacesAtom, updateModelList(workspace));

        await navigate({
          to: '/workspaces/$workspaceId',
          params: { workspaceId: workspace.id },
        });
      },
      onSettled: () => trackEvent('workspace', 'create'),
    }),

    createFolder: createFastMutation<
      Folder | null,
      void,
      Partial<Pick<Folder, 'name' | 'sortPriority' | 'folderId'>>
    >({
      mutationKey: ['create_folder'],
      mutationFn: async (patch) => {
        const workspaceId = getActiveWorkspaceId();
        if (workspaceId == null) {
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
        return invokeCmd<Folder>('cmd_update_folder', { folder: { workspaceId, ...patch } });
      },
      onSuccess: async (folder) => {
        if (folder == null) return;

        // Optimistic update
        jotaiStore.set(foldersAtom, updateModelList(folder));
      },
      onSettled: () => trackEvent('folder', 'create'),
    }),
  } as const;
}

export function useCommands() {
  const navigate = useNavigate();
  const toast = useToast();
  const prompt = usePrompt();
  return useMemo(() => makeCommands({ navigate, toast, prompt }), [navigate, prompt, toast]);
}
