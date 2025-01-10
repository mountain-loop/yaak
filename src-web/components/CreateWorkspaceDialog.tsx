import { useState } from 'react';
import { upsertWorkspace } from '../commands/upsertWorkspace';
import { upsertWorkspaceMeta } from '../commands/upsertWorkspaceMeta';
import { router } from '../lib/router';
import { getWorkspaceMeta } from '../lib/store';
import { Button } from './core/Button';
import { PlainInput } from './core/PlainInput';
import { VStack } from './core/Stacks';
import type { SyncToFilesystemSettingProps } from './SyncToFilesystemSetting';
import { SyncToFilesystemSetting } from './SyncToFilesystemSetting';

interface Props {
  hide: () => void;
}

export function CreateWorkspaceDialog({ hide }: Props) {
  const [name, setName] = useState<string>('');
  const [settingSyncDir, setSettingSyncDir] = useState<
    Parameters<SyncToFilesystemSettingProps['onChange']>[0]
  >({ value: null, enabled: false });

  return (
    <VStack
      as="form"
      space={3}
      alignItems="start"
      className="pb-3 max-h-[50vh]"
      onSubmit={async (e) => {
        e.preventDefault();
        const { enabled, value } = settingSyncDir ?? {};
        if (enabled && !value) return;
        const workspace = await upsertWorkspace.mutateAsync({ name });
        if (workspace == null) return;

        // Do getWorkspaceMeta instead of naively creating one because it might have
        // been created already when the store refreshes the workspace meta after
        const workspaceMeta = await getWorkspaceMeta(workspace.id);
        upsertWorkspaceMeta.mutate({ ...workspaceMeta, settingSyncDir: value });

        // Navigate to workspace
        await router.navigate({
          to: '/workspaces/$workspaceId',
          params: { workspaceId: workspace.id },
        });

        hide();
      }}
    >
      <PlainInput require label="Workspace Name" defaultValue={name} onChange={setName} />

      <SyncToFilesystemSetting
        onChange={setSettingSyncDir}
        value={settingSyncDir.value}
        allowNonEmptyDirectory // Will do initial import when the workspace is created
      />
      <Button
        type="submit"
        color="primary"
        className="ml-auto mt-3"
        disabled={settingSyncDir.enabled && !settingSyncDir.value}
      >
        Create Workspace
      </Button>
    </VStack>
  );
}
