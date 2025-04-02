import { patchModel, workspaceMetasAtom, workspacesAtom } from '@yaakapp-internal/models';
import { useAtomValue } from 'jotai/index';
import { deleteModelWithConfirm } from '../lib/deleteModelWithConfirm';
import { router } from '../lib/router';
import { Banner } from './core/Banner';
import { Button } from './core/Button';
import { Heading } from './core/Heading';
import { InlineCode } from './core/InlineCode';
import { Input } from './core/Input';
import { Separator } from './core/Separator';
import { VStack } from './core/Stacks';
import { Tooltip } from './core/Tooltip';
import { EnableWorkspaceEncryptionSetting } from './EnableWorkspaceEncryptionSetting';
import { MarkdownEditor } from './MarkdownEditor';
import { SyncToFilesystemSetting } from './SyncToFilesystemSetting';

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
        <SyncToFilesystemSetting
          value={{ filePath: workspaceMeta.settingSyncDir }}
          onCreateNewWorkspace={hide}
          onChange={({ filePath }) => patchModel(workspaceMeta, { settingSyncDir: filePath })}
        />
        <VStack space={3}>
          <Heading level={2}>
            Encryption{' '}
            <Tooltip
              content={
                <>
                  Use the <InlineCode>secure(...)</InlineCode> template function, or encrypt synced
                  data and exports.
                </>
              }
            />
          </Heading>
          <EnableWorkspaceEncryptionSetting workspaceMeta={workspaceMeta} />
        </VStack>
        <Separator className="my-4" />
        <Button
          onClick={async () => {
            const didDelete = await deleteModelWithConfirm(workspace);
            if (didDelete) {
              hide(); // Only hide if actually deleted workspace
              await router.navigate({ to: '/workspaces' });
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
