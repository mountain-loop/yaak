import { foldersAtom, patchModel } from '@yaakapp-internal/models';
import { useAtomValue } from 'jotai';
import { Input } from './core/Input';
import { VStack } from './core/Stacks';
import { MarkdownEditor } from './MarkdownEditor';

interface Props {
  folderId: string | null;
}

export function FolderSettingsDialog({ folderId }: Props) {
  const folders = useAtomValue(foldersAtom);
  const folder = folders.find((f) => f.id === folderId);

  if (folder == null) return null;

  return (
    <VStack space={3} className="pb-3">
      <Input
        label="Folder Name"
        defaultValue={folder.name}
        onChange={(name) => patchModel(folder, { name })}
        stateKey={`name.${folder.id}`}
      />

      <MarkdownEditor
        name="folder-description"
        placeholder="Folder description"
        className="min-h-[10rem] border border-border px-2"
        defaultValue={folder.description}
        stateKey={`description.${folder.id}`}
        onChange={(description) => patchModel(folder, { description })}
      />
    </VStack>
  );
}
