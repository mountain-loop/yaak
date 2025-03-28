import { patchModel, useModelList } from '@yaakapp-internal/models';
import { useAtomValue } from 'jotai';
import { activeWorkspaceMetaAtom } from '../hooks/useActiveWorkspace';
import { useDeleteActiveWorkspace } from '../hooks/useDeleteActiveWorkspace';
import { Banner } from './core/Banner';
import { Button } from './core/Button';
import { InlineCode } from './core/InlineCode';
import { Input } from './core/Input';
import { Separator } from './core/Separator';
import { VStack } from './core/Stacks';
import { MarkdownEditor } from './MarkdownEditor';
import { SyncToFilesystemSetting } from './SyncToFilesystemSetting';

interface Props {
  workspaceId: string | null;
  hide: () => void;
  openSyncMenu?: boolean;
}

export function WorkspaceSettingsDialog({ workspaceId, hide, openSyncMenu }: Props) {
  const workspaces = useModelList('workspace');
  const workspace = workspaces.find((w) => w.id === workspaceId);
  const workspaceMeta = useAtomValue(activeWorkspaceMetaAtom);
  const { mutateAsync: deleteActiveWorkspace } = useDeleteActiveWorkspace();

  if (workspace == null) {
    return (
      <Banner color="danger">
        <InlineCode>Workspace</InlineCode> not found
      </Banner>
    );
  }

  if (workspaceMeta == null)
    return (
      <Banner color="danger">
        <InlineCode>WorkspaceMeta</InlineCode> not found for workspace
      </Banner>
    );

  return (
    <VStack space={3} alignItems="start" className="pb-3 h-full">
      <Input
        required
        label="Name"
        defaultValue={workspace.name}
        onChange={(name) => patchModel(workspace, { name })}
        stateKey={`name.${workspace.id}`}
      />

      <MarkdownEditor
        name="workspace-description"
        placeholder="Workspace description"
        className="min-h-[10rem] max-h-[25rem] border border-border px-2"
        defaultValue={workspace.description}
        stateKey={`description.${workspace.id}`}
        onChange={(description) => patchModel(workspace, { description })}
        heightMode="auto"
      />

      <VStack space={6} className="mt-3 w-full" alignItems="start">
        <SyncToFilesystemSetting
          value={{ filePath: workspaceMeta.settingSyncDir }}
          forceOpen={openSyncMenu}
          onCreateNewWorkspace={hide}
          onChange={({ filePath }) => patchModel(workspaceMeta, { settingSyncDir: filePath })}
        />
        <Separator />
        <Button
          onClick={async () => {
            const workspace = await deleteActiveWorkspace();
            if (workspace) {
              hide(); // Only hide if actually deleted workspace
            }
          }}
          color="danger"
          variant="border"
          size="xs"
        >
          Delete Workspace
        </Button>
      </VStack>
    </VStack>
  );
}
