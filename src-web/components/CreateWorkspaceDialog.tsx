import { useGitInit } from '@yaakapp-internal/git';
import type { WorkspaceMeta } from '@yaakapp-internal/models';
import { createGlobalModel, patchModel } from '@yaakapp-internal/models';
import { useState } from 'react';
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
  const gitInit = useGitInit();
  const [syncConfig, setSyncConfig] = useState<{
    filePath: string | null;
    initGit?: boolean;
  }>({ filePath: null, initGit: false });

  return (
    <VStack
      as="form"
      space={3}
      alignItems="start"
      className="pb-3 max-h-[50vh]"
      onSubmit={async (e) => {
        e.preventDefault();
        const workspaceId = await createGlobalModel({ model: 'workspace', name });
        if (workspaceId == null) return;

        // Do getWorkspaceMeta instead of naively creating one because it might have
        // been created already when the store refreshes the workspace meta after
        const workspaceMeta = await invokeCmd<WorkspaceMeta>('cmd_get_workspace_meta', {
          workspaceId,
        });
        await patchModel(workspaceMeta, {
          settingSyncDir: syncConfig.filePath,
        });

        if (syncConfig.initGit && syncConfig.filePath) {
          gitInit.mutateAsync({ dir: syncConfig.filePath }).catch((err) => {
            showErrorToast('git-init-error', String(err));
          });
        }

        // Navigate to workspace
        await router.navigate({
          to: '/workspaces/$workspaceId',
          params: { workspaceId },
        });

        hide();
      }}
    >
      <PlainInput required label="Name" defaultValue={name} onChange={setName} />

      <SyncToFilesystemSetting
        onChange={setSyncConfig}
        onCreateNewWorkspace={hide}
        value={syncConfig}
      />
      <Button type="submit" color="primary" className="ml-auto mt-3">
        Create Workspace
      </Button>
    </VStack>
  );
}
