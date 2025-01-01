import { useFolders } from '../hooks/useFolders';
import { useUpdateAnyFolder } from '../hooks/useUpdateAnyFolder';
import { PlainInput } from './core/PlainInput';
import { VStack } from './core/Stacks';
import { MarkdownEditor } from './MarkdownEditor';

interface Props {
  folderId: string | null;
}

export function FolderSettingsDialog({ folderId }: Props) {
  const { mutate: updateFolder } = useUpdateAnyFolder();
  const folders = useFolders();
  const folder = folders.find((f) => f.id === folderId);

  if (folder == null) return null;

  return (
    <VStack space={3} className="pb-3">
      <PlainInput
        label="Folder Name"
        defaultValue={folder.name}
        onChange={(name) => {
          if (folderId == null) return;
          updateFolder({ id: folderId, update: (folder) => ({ ...folder, name }) });
        }}
      />

      <MarkdownEditor
        name="folder-description"
        placeholder="Folder description"
        className="min-h-[10rem] border border-border px-2"
        defaultValue={folder.description}
        stateKey={`description.${folder.id}`}
        onChange={(description) => {
          if (folderId == null) return;
          updateFolder({
            id: folderId,
            update: (folder) => ({ ...folder, description }),
          });
        }}
      />
    </VStack>
  );
}
