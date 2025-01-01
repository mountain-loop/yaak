import { useUpdateWorkspace } from '../hooks/useUpdateWorkspace';
import { useWorkspaces } from '../hooks/useWorkspaces';
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
    <VStack space={3} className="pb-3 max-h-[50vh]">
        {workspace.id}
      <PlainInput
        label="Workspace Name"
        defaultValue={workspace.name}
        onChange={(name) => updateWorkspace.mutate({ name })}
      />

      <MarkdownEditor
        name="workspace-description"
        placeholder="Workspace description"
        className="min-h-[10rem] border border-border px-2"
        defaultValue={workspace.description}
        stateKey={`description.${workspace.id}`}
        onChange={(description) => updateWorkspace.mutate({ description })}
        heightMode='auto'
      />
    </VStack>
  );
}
