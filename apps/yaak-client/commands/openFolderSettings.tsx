import { getModel } from '@yaakapp-internal/models';
import type { FolderSettingsTab } from '../components/FolderSettingsDialog';
import { FolderSettingsDialog } from '../components/FolderSettingsDialog';
import { showDialog } from '../lib/dialog';

export function openFolderSettings(folderId: string, tab?: FolderSettingsTab) {
  const folder = getModel('folder', folderId);
  if (folder == null) return;
  showDialog({
    id: 'folder-settings',
    title: null,
    size: 'lg',
    className: 'h-[50rem]',
    noPadding: true,
    render: () => <FolderSettingsDialog folderId={folderId} tab={tab} />,
  });
}
