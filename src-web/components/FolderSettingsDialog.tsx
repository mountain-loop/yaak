import { useFolders } from '../hooks/useFolders';
import { useUpdateAnyFolder } from '../hooks/useUpdateAnyFolder';
import { Banner } from './core/Banner';
import { PlainInput } from './core/PlainInput';
import { VStack } from './core/Stacks';
import { MarkdownEditor } from './MarkdownEditor';

interface Props {
  folderId: string | null;
}

export function FolderSettingsDialog({ folderId }: Props) {
  const updateFolder = useUpdateAnyFolder();
  const folders = useFolders();
  const folder = folders.find((f) => f.id === folderId);

  if (folder == null) return null;

  return (
    <VStack space={3} className="pb-3">
      {updateFolder.error != null && <Banner color="danger">{String(updateFolder.error)}</Banner>}
      <PlainInput
        label="Folder Name"
        defaultValue={folder.name}
        onChange={(name) => {
          if (folderId == null) return;
          updateFolder.mutate({ id: folderId, update: (folder) => ({ ...folder, name }) });
        }}
      />

      <MarkdownEditor
        name="folder-description"
        placeholder="A Markdown description of this folder."
        className="min-h-[10rem] border border-border px-2"
        defaultValue={folder.description}
        onChange={(description) => {
          if (folderId == null) return;
          updateFolder.mutate({
            id: folderId,
            update: (folder) => ({ ...folder, description }),
          });
        }}
      />
    </VStack>
  );
}
