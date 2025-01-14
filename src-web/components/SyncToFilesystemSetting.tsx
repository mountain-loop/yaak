import { readDir } from '@tauri-apps/plugin-fs';
import { useState } from 'react';
import { Banner } from './core/Banner';
import { VStack } from './core/Stacks';
import { SelectFile } from './SelectFile';

export interface SyncToFilesystemSettingProps {
  onChange: (filePath: string | null) => void;
  value: string | null;
  allowNonEmptyDirectory?: boolean;
}

export function SyncToFilesystemSetting({
  onChange,
  value,
  allowNonEmptyDirectory,
}: SyncToFilesystemSettingProps) {
  const [error, setError] = useState<string | null>(null);

  return (
    <details open={value != null} className="w-full">
      <summary>Sync to filesystem</summary>
      <VStack className="my-2" space={3}>
        <Banner color="info">
          When enabled, workspace data syncs to the chosen folder as text files, ideal for backup
          and Git collaboration.
        </Banner>
        {error && <div className="text-danger">{error}</div>}

        <SelectFile
          directory
          color="primary"
          size="xs"
          noun="Directory"
          filePath={value}
          onChange={async ({ filePath }) => {
            if (filePath != null) {
              const files = await readDir(filePath);
              if (files.length > 0 && !allowNonEmptyDirectory) {
                setError('The directory must be empty');
                return;
              }
            }

            onChange(filePath);
          }}
        />
      </VStack>
    </details>
  );
}
