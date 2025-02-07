import { gitInit } from '@yaakapp-internal/git';
import type { WorkspaceMeta } from '@yaakapp-internal/models';
import { useState } from 'react';
import { upsertWorkspace } from '../commands/upsertWorkspace';
import { upsertWorkspaceMeta } from '../commands/upsertWorkspaceMeta';
import { router } from '../lib/router';
import { invokeCmd } from '../lib/tauri';
import { showErrorToast } from '../lib/toast';
import { Button } from './core/Button';
import { PlainInput } from './core/PlainInput';
import { VStack } from './core/Stacks';
import { SyncToFilesystemSetting } from './SyncToFilesystemSetting';

interface Props {
  hide: () => void;
}

export function CreateWorkspaceDialog({ hide }: Props) {
  const [name, setName] = useState<string>('');
  const [syncConfig, setSyncConfig] = useState<{
    filePath: string | null;
    initGit?: boolean;
  }>({ filePath: null, initGit: true });

  return (
    <VStack
      as="form"
      space={3}
      alignItems="start"
      className="pb-3 max-h-[50vh]"
      onSubmit={async (e) => {
        e.preventDefault();
        const workspace = await upsertWorkspace.mutateAsync({ name });
        if (workspace == null) return;

        // Do getWorkspaceMeta instead of naively creating one because it might have
        // been created already when the store refreshes the workspace meta after
        const workspaceMeta = await invokeCmd<WorkspaceMeta>('cmd_get_workspace_meta', {
          workspaceId: workspace.id,
        });
        await upsertWorkspaceMeta.mutateAsync({
          ...workspaceMeta,
          settingSyncDir: syncConfig.filePath,
        });

        if (syncConfig.initGit && syncConfig.filePath) {
          gitInit(syncConfig.filePath).catch((err) => {
            showErrorToast('git-init-error', String(err));
          });
        }

        // Navigate to workspace
        await router.navigate({
          to: '/workspaces/$workspaceId',
          params: { workspaceId: workspace.id },
        });

        hide();
      }}
    >
      <PlainInput required label="Name" defaultValue={name} onChange={setName} />

      <SyncToFilesystemSetting
        onChange={setSyncConfig}
        value={syncConfig}
        allowNonEmptyDirectory // Will do initial import when the workspace is created
      />
      <Button type="submit" color="primary" className="ml-auto mt-3">
        Create Workspace
      </Button>
    </VStack>
  );
}
