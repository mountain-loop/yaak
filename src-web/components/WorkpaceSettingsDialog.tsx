import { useUpdateWorkspace } from '../hooks/useUpdateWorkspace';
import { useWorkspaces } from '../hooks/useWorkspaces';
import { Banner } from './core/Banner';
import { PlainInput } from './core/PlainInput';
import { VStack } from './core/Stacks';
import { MarkdownEditor } from './MarkdownEditor';

interface Props {
  workspaceId: string | null;
}

export function WorkspaceSettingsDialog({ workspaceId }: Props) {
  const updateWorkspace = useUpdateWorkspace(workspaceId ?? null);
  const workspaces = useWorkspaces();
  const workspace = workspaces.find((w) => w.id === workspaceId);

  if (workspace == null) return null;

  return (
    <VStack space={3} className="pb-3">
      {updateWorkspace.error != null && (
        <Banner color="danger">{String(updateWorkspace.error)}</Banner>
      )}
      <PlainInput
        label="Workspace Name"
        defaultValue={workspace.name}
        onChange={(name) => updateWorkspace.mutate({ name })}
      />

      <MarkdownEditor
        name="workspace-description"
        placeholder="A Markdown description of this workspace."
        className="min-h-[10rem] border border-border px-2"
        defaultValue={workspace.description}
        onChange={(description) => updateWorkspace.mutate({ description })}
      />
    </VStack>
  );
}
