import type { Folder } from '@yaakapp-internal/models';
import { createWorkspaceModel } from '@yaakapp-internal/models';
import { applySync, calculateSync } from '@yaakapp-internal/sync';
import { Banner } from '../components/core/Banner';
import { InlineCode } from '../components/core/InlineCode';
import { VStack } from '../components/core/Stacks';
import { activeWorkspaceIdAtom } from '../hooks/useActiveWorkspace';
import { createFastMutation } from '../hooks/useFastMutation';
import { showConfirm } from '../lib/confirm';
import { jotaiStore } from '../lib/jotai';
import { pluralizeCount } from '../lib/pluralize';
import { showPrompt } from '../lib/prompt';
import { resolvedModelNameWithFolders } from '../lib/resolvedModelName';

export const createFolder = createFastMutation<
  void,
  void,
  Partial<Pick<Folder, 'name' | 'sortPriority' | 'folderId'>>
>({
  mutationKey: ['create_folder'],
  mutationFn: async (patch) => {
    const workspaceId = jotaiStore.get(activeWorkspaceIdAtom);
    if (workspaceId == null) {
      throw new Error("Cannot create folder when there's no active workspace");
    }

    if (!patch.name) {
      const name = await showPrompt({
        id: 'new-folder',
        label: 'Name',
        defaultValue: 'Folder',
        title: 'New Folder',
        required: true,
        confirmText: 'Create',
        placeholder: 'Name',
      });
      if (name == null) return;

      patch.name = name;
    }

    patch.sortPriority = patch.sortPriority || -Date.now();
    await createWorkspaceModel({ model: 'folder', workspaceId, ...patch });
  },
});

export const syncWorkspace = createFastMutation<
  void,
  void,
  { workspaceId: string; syncDir: string; force?: boolean }
>({
  mutationKey: [],
  mutationFn: async ({ workspaceId, syncDir, force }) => {
    const ops = (await calculateSync(workspaceId, syncDir)) ?? [];
    if (ops.length === 0) {
      console.log('Nothing to sync', workspaceId, syncDir);
      return;
    }
    console.log('Syncing workspace', workspaceId, syncDir, ops);

    const dbOps = ops.filter((o) => o.type.startsWith('db'));

    if (dbOps.length === 0) {
      await applySync(workspaceId, syncDir, ops);
      return;
    }

    const isDeletingWorkspace = ops.some(
      (o) => o.type === 'dbDelete' && o.model.model === 'workspace',
    );

    console.log('Directory changes detected', { dbOps, ops });

    const confirmed = force
      ? true
      : await showConfirm({
          id: 'commit-sync',
          title: 'Changes Detected',
          confirmText: 'Apply Changes',
          color: isDeletingWorkspace ? 'danger' : 'primary',
          description: (
            <VStack space={3}>
              {isDeletingWorkspace && (
                <Banner color="danger">
                  🚨 <strong>Changes contain a workspace deletion!</strong>
                </Banner>
              )}
              <p>
                {pluralizeCount('file', dbOps.length)} in the directory{' '}
                {dbOps.length === 1 ? 'has' : 'have'} changed. Do you want to update your workspace?
              </p>
              <div className="overflow-y-auto max-h-[10rem]">
                <table className="w-full text-sm mb-auto min-w-full max-w-full divide-y divide-surface-highlight">
                  <thead>
                    <tr>
                      <th className="py-1 text-left">Name</th>
                      <th className="py-1 text-right pl-4">Operation</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-surface-highlight">
                    {dbOps.map((op, i) => {
                      let name = '';
                      let label = '';
                      let color = '';

                      if (op.type === 'dbCreate') {
                        label = 'create';
                        name = resolvedModelNameWithFolders(op.fs.model);
                        color = 'text-success';
                      } else if (op.type === 'dbUpdate') {
                        label = 'update';
                        name = resolvedModelNameWithFolders(op.fs.model);
                        color = 'text-info';
                      } else if (op.type === 'dbDelete') {
                        label = 'delete';
                        name = resolvedModelNameWithFolders(op.model);
                        color = 'text-danger';
                      } else {
                        return null;
                      }

                      return (
                        <tr key={i} className="text-text">
                          <td className="py-1">{name}</td>
                          <td className="py-1 pl-4 text-right">
                            <InlineCode className={color}>{label}</InlineCode>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </VStack>
          ),
        });
    if (confirmed) {
      await applySync(workspaceId, syncDir, ops);
    }
  },
});
