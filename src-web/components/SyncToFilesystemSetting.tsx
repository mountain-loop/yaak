import { readDir } from '@tauri-apps/plugin-fs';
import { useState } from 'react';
import { Banner } from './core/Banner';
import { Checkbox } from './core/Checkbox';
import { VStack } from './core/Stacks';
import { SelectFile } from './SelectFile';

export interface SyncToFilesystemSettingProps {
  onChange: (args: { filePath: string | null; initGit?: boolean }) => void;
  value: { filePath: string | null; initGit?: boolean };
  allowNonEmptyDirectory?: boolean;
  forceOpen?: boolean;
}

export function SyncToFilesystemSetting({
  onChange,
  value,
  allowNonEmptyDirectory,
  forceOpen,
}: SyncToFilesystemSettingProps) {
  const [error, setError] = useState<string | null>(null);
  return (
    <details open={forceOpen || value != null} className="w-full">
      <summary>Data directory {typeof value.initGit === 'boolean' && ' and Git'}</summary>
      <VStack className="my-2" space={3}>
        <Banner color="info">
          Sync workspace data to folder as plain text files, ideal for backup and Git collaboration.
        </Banner>
        {error && <div className="text-danger">{error}</div>}

        <SelectFile
          directory
          size="xs"
          noun="Directory"
          filePath={value.filePath}
          onChange={async ({ filePath }) => {
            if (filePath != null) {
              const files = await readDir(filePath);
              if (files.length > 0 && !allowNonEmptyDirectory) {
                setError('The directory must be empty');
                return;
              }
            }

            onChange({ ...value, filePath });
          }}
        />

        {value.filePath && typeof value.initGit === 'boolean' && (
          <Checkbox
            checked={value.initGit}
            onChange={(initGit) => onChange({ ...value, initGit })}
            title="Initialize Git Repo"
          />
        )}
      </VStack>
    </details>
  );
}
