import { readDir } from '@tauri-apps/plugin-fs';
import { useState } from 'react';
import { openWorkspaceFromSyncDir } from '../commands/openWorkspaceFromSyncDir';
import { Banner } from './core/Banner';
import { Button } from './core/Button';
import { Checkbox } from './core/Checkbox';
import { VStack } from './core/Stacks';
import { SelectFile } from './SelectFile';

export interface SyncToFilesystemSettingProps {
  onChange: (args: { filePath: string | null; initGit?: boolean }) => void;
  onCreateNewWorkspace: () => void;
  value: { filePath: string | null; initGit?: boolean };
}

export function SyncToFilesystemSetting({
  onChange,
  onCreateNewWorkspace,
  value,
}: SyncToFilesystemSettingProps) {
  const [isNonEmpty, setIsNonEmpty] = useState<string | null>(null);
  return (
    <VStack className="w-full my-2" space={3}>
      {isNonEmpty && (
        <Banner color="notice" className="flex flex-col gap-1.5">
          <p>Directory is not empty. Do you want to open it instead?</p>
          <div>
            <Button
              variant="border"
              color="notice"
              size="xs"
              type="button"
              onClick={() => {
                openWorkspaceFromSyncDir.mutate(isNonEmpty);
                onCreateNewWorkspace();
              }}
            >
              Open Workspace
            </Button>
          </div>
        </Banner>
      )}

      <SelectFile
        directory
        label="Local directory sync"
        size="xs"
        noun="Directory"
        help="Sync data to a folder for backup and Git integration."
        filePath={value.filePath}
        onChange={async ({ filePath }) => {
          if (filePath != null) {
            const files = await readDir(filePath);
            if (files.length > 0) {
              setIsNonEmpty(filePath);
              return;
            }
          }

          setIsNonEmpty(null);
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
  );
}
