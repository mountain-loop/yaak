import { useState } from 'react';
import { useCommands } from '../hooks/useCommands';
import { PlainInput } from './core/PlainInput';
import { VStack } from './core/Stacks';
import { MarkdownEditor } from './MarkdownEditor';

interface Props {
  hide: () => void;
}

export function CreateWorkspaceDialog({ hide }: Props) {
  const [name, setName] = useState<string>('');
  const [description, setDescription] = useState<string>('');
  const { createWorkspace } = useCommands();

  return (
    <VStack
      as="form"
      space={3}
      alignItems="start"
      className="pb-3 max-h-[50vh]"
      onSubmit={async (e) => {
        e.preventDefault();
        await createWorkspace.mutateAsync({ name, description });
        hide();
      }}
    >
      <PlainInput label="Workspace Name" defaultValue={name} onChange={setName} />

      <MarkdownEditor
        name="workspace-description"
        placeholder="Workspace description"
        className="min-h-[10rem] max-h-[25rem] border border-border px-2"
        defaultValue={description}
        stateKey={null}
        onChange={setDescription}
        heightMode="auto"
      />
    </VStack>
  );
}
