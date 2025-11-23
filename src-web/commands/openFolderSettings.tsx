import { getModel } from '@yaakapp-internal/models';
import { Icon } from '../components/core/Icon';
import { HStack } from '../components/core/Stacks';
import type { FolderSettingsTab } from '../components/FolderSettingsDialog';
import { FolderSettingsDialog } from '../components/FolderSettingsDialog';
import { showDialog } from '../lib/dialog';
import { resolvedModelName } from '../lib/resolvedModelName';

export function openFolderSettings(folderId: string, tab?: FolderSettingsTab) {
  const folder = getModel('folder', folderId);
  showDialog({
    id: 'folder-settings',
    title: (
      <HStack space={2} alignItems="center">
        <Icon icon="folder_cog" size="xl" color="secondary" />
        {resolvedModelName(folder)}
      </HStack>
    ),
    size: 'lg',
    className: 'h-[50rem]',
    noPadding: true,
    render: () => <FolderSettingsDialog folderId={folderId} tab={tab} />,
  });
}
