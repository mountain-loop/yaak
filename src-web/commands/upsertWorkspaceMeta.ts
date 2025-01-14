import type { WorkspaceMeta } from '@yaakapp-internal/models';
import { createFastMutation } from '../hooks/useFastMutation';
import { workspaceMetaAtom } from '../hooks/useWorkspaceMeta';
import { jotaiStore } from '../lib/jotai';
import { invokeCmd } from '../lib/tauri';

export const upsertWorkspaceMeta = createFastMutation<
  WorkspaceMeta,
  unknown,
  WorkspaceMeta | (Partial<Omit<WorkspaceMeta, 'id'>> & { workspaceId: string })
>({
  mutationKey: ['update_workspace_meta'],
  mutationFn: async (patch) => {
    const workspaceMeta = jotaiStore.get(workspaceMetaAtom);
    return invokeCmd<WorkspaceMeta>('cmd_update_workspace_meta', {
      workspaceMeta: { ...workspaceMeta, ...patch },
    });
  },
});
