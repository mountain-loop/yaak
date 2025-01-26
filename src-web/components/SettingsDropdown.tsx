import { openUrl } from '@tauri-apps/plugin-opener';
import { useRef } from 'react';
import { useAppInfo } from '../hooks/useAppInfo';
import { useCheckForUpdates } from '../hooks/useCheckForUpdates';
import { useExportData } from '../hooks/useExportData';
import { useImportData } from '../hooks/useImportData';
import { useListenToTauriEvent } from '../hooks/useListenToTauriEvent';
import { useOpenSettings } from '../hooks/useOpenSettings';
import { showDialog } from '../lib/dialog';
import type { DropdownRef } from './core/Dropdown';
import { Dropdown } from './core/Dropdown';
import { Icon } from './core/Icon';
import { IconButton } from './core/IconButton';
import { KeyboardShortcutsDialog } from './KeyboardShortcutsDialog';

export function SettingsDropdown() {
  const importData = useImportData();
  const exportData = useExportData();
  const appInfo = useAppInfo();
  const dropdownRef = useRef<DropdownRef>(null);
  const checkForUpdates = useCheckForUpdates();
  const openSettings = useOpenSettings();

  useListenToTauriEvent('settings', () => openSettings.mutate());

  return (
    <Dropdown
      ref={dropdownRef}
      items={[
        {
          label: 'Settings',
          hotKeyAction: 'settings.show',
          leftSlot: <Icon icon="settings" />,
          onSelect: openSettings.mutate,
        },
        {
          label: 'Keyboard shortcuts',
          hotKeyAction: 'hotkeys.showHelp',
          leftSlot: <Icon icon="keyboard" />,
          onSelect: () => {
            showDialog({
              id: 'hotkey',
              title: 'Keyboard Shortcuts',
              size: 'dynamic',
              render: () => <KeyboardShortcutsDialog />,
            });
          },
        },
        {
          label: 'Import Data',
          leftSlot: <Icon icon="folder_input" />,
          onSelect: () => importData.mutate(),
        },
        {
          label: 'Export Data',
          leftSlot: <Icon icon="folder_output" />,
          onSelect: () => exportData.mutate(),
        },
        { type: 'separator', label: `Yaak v${appInfo.version}` },
        {
          label: 'Check for Updates',
          leftSlot: <Icon icon="update" />,
          onSelect: () => checkForUpdates.mutate(),
        },
        {
          label: 'Feedback',
          leftSlot: <Icon icon="chat" />,
          rightSlot: <Icon icon="external_link" />,
          onSelect: () => openUrl('https://yaak.app/roadmap'),
        },
        {
          label: 'Changelog',
          leftSlot: <Icon icon="cake" />,
          rightSlot: <Icon icon="external_link" />,
          onSelect: () => openUrl(`https://yaak.app/changelog/${appInfo.version}`),
        },
      ]}
    >
      <IconButton size="sm" title="Main Menu" icon="settings" className="pointer-events-auto" />
    </Dropdown>
  );
}
