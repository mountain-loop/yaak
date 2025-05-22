import type { FolderSettingsTab } from '../components/FolderSettingsDialog';
import { FolderSettingsDialog } from '../components/FolderSettingsDialog';
import { showDialog } from '../lib/dialog';

export function openFolderSettings(folderId: string, tab?: FolderSettingsTab) {
  showDialog({
    id: 'folder-settings',
    title: 'Folder Settings',
    size: 'lg',
    className: 'h-[50rem]',
    noPadding: true,
    render: () => <FolderSettingsDialog folderId={folderId} tab={tab} />,
  });
}
