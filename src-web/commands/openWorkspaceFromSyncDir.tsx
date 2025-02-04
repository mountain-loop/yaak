import { open } from '@tauri-apps/plugin-dialog';
import { applySync, calculateSyncFsOnly } from '@yaakapp-internal/sync';
import { createFastMutation } from '../hooks/useFastMutation';
import { showSimpleAlert } from '../lib/alert';
import { router } from '../lib/router';

export const openWorkspaceFromSyncDir = createFastMutation<void>({
  mutationKey: [],
  mutationFn: async () => {
    const dir = await open({
      title: 'Select Workspace Directory',
      directory: true,
      multiple: false,
    });

    if (dir == null) return;

    const ops = await calculateSyncFsOnly(dir);

    const workspace = ops
      .map((o) => (o.type === 'dbCreate' && o.fs.model.type === 'workspace' ? o.fs.model : null))
      .filter((m) => m)[0];
    if (workspace == null) {
      showSimpleAlert('Failed to Open', 'No workspace found in directory');
      return;
    }

    await applySync(workspace.id, dir, ops);

    router.navigate({
      to: '/workspaces/$workspaceId',
      params: { workspaceId: workspace.id },
    });
  },
});
