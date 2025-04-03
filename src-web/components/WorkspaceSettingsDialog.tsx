import { patchModel, workspaceMetasAtom, workspacesAtom } from '@yaakapp-internal/models';
import { useAtomValue } from 'jotai/index';
import { deleteModelWithConfirm } from '../lib/deleteModelWithConfirm';
import { router } from '../lib/router';
import { Banner } from './core/Banner';
import { Button } from './core/Button';
import { InlineCode } from './core/InlineCode';
import { Input } from './core/Input';
import { Separator } from './core/Separator';
import { VStack } from './core/Stacks';
import { MarkdownEditor } from './MarkdownEditor';
import { SyncToFilesystemSetting } from './SyncToFilesystemSetting';
import { WorkspaceEncryptionSetting } from './WorkspaceEncryptionSetting';

interface Props {
  workspaceId: string | null;
  hide: () => void;
}

export function WorkspaceSettingsDialog({ workspaceId, hide }: Props) {
  const workspace = useAtomValue(workspacesAtom).find((w) => w.id === workspaceId);
  const workspaceMeta = useAtomValue(workspaceMetasAtom).find((m) => m.workspaceId === workspaceId);

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

      <VStack space={3} className="mt-3 w-full" alignItems="start">
        <WorkspaceEncryptionSetting size="xs" workspace={workspace} workspaceMeta={workspaceMeta} />
        <SyncToFilesystemSetting
          value={{ filePath: workspaceMeta.settingSyncDir }}
          onCreateNewWorkspace={hide}
          onChange={({ filePath }) => patchModel(workspaceMeta, { settingSyncDir: filePath })}
        />
        <Separator className="my-4" />
        <Button
          onClick={async () => {
            const didDelete = await deleteModelWithConfirm(workspace);
            if (didDelete) {
              hide(); // Only hide if actually deleted workspace
              await router.navigate({ to: '/' });
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
