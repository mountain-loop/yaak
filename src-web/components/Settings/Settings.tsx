import { useSearch } from '@tanstack/react-router';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import classNames from 'classnames';
import React, { useState } from 'react';
import { useKeyPressEvent } from 'react-use';
import { useOsInfo } from '../../hooks/useOsInfo';
import { capitalize } from '../../lib/capitalize';
import { HStack } from '../core/Stacks';
import { TabContent, Tabs } from '../core/Tabs/Tabs';
import { HeaderSize } from '../HeaderSize';
import { SettingsAppearance } from './SettingsAppearance';
import { SettingsGeneral } from './SettingsGeneral';
import { SettingsLicense } from './SettingsLicense';
import { SettingsPlugins } from './SettingsPlugins';
import { SettingsProxy } from './SettingsProxy';
import { SettingsTab } from './SettingsTab';

interface Props {
  hide?: () => void;
}

const tabs = [
  SettingsTab.General,
  SettingsTab.Appearance,
  SettingsTab.Proxy,
  SettingsTab.Plugins,
  SettingsTab.License,
];

export default function Settings({ hide }: Props) {
  const osInfo = useOsInfo();
  const { tab: tabFromQuery } = useSearch({ from: '/workspaces/$workspaceId/settings' });
  const [tab, setTab] = useState<string>(tabFromQuery ?? SettingsTab.General);

  // Close settings window on escape
  // TODO: Could this be put in a better place? Eg. in Rust key listener when creating the window
  useKeyPressEvent('Escape', async () => {
    if (hide != null) {
      // It's being shown in a dialog, so close the dialog
      hide();
    } else {
      // It's being shown in a window, so close the window
      await getCurrentWebviewWindow().close();
    }
  });

  return (
    <div className={classNames('grid grid-rows-[auto_minmax(0,1fr)] h-full')}>
      {hide ? (
        <span />
      ) : (
        <HeaderSize
          data-tauri-drag-region
          ignoreControlsSpacing
          onlyXWindowControl
          size="md"
          className="x-theme-appHeader bg-surface text-text-subtle flex items-center justify-center border-b border-border-subtle text-sm font-semibold"
        >
          <HStack
            space={2}
            justifyContent="center"
            className="w-full h-full grid grid-cols-[1fr_auto] pointer-events-none"
          >
            <div className={classNames(osInfo?.osType === 'macos' ? 'text-center' : 'pl-2')}>
              Settings
            </div>
          </HStack>
        </HeaderSize>
      )}
      <Tabs
        value={tab}
        addBorders
        label="Settings"
        onChangeValue={setTab}
        tabs={tabs.map((value) => ({ value, label: capitalize(value) }))}
      >
        <TabContent value={SettingsTab.General} className="pt-3 overflow-y-auto h-full px-4">
          <SettingsGeneral />
        </TabContent>
        <TabContent value={SettingsTab.Appearance} className="pt-3 overflow-y-auto h-full px-4">
          <SettingsAppearance />
        </TabContent>
        <TabContent value={SettingsTab.Plugins} className="pt-3 overflow-y-auto h-full px-4">
          <SettingsPlugins />
        </TabContent>
        <TabContent value={SettingsTab.Proxy} className="pt-3 overflow-y-auto h-full px-4">
          <SettingsProxy />
        </TabContent>
        <TabContent value={SettingsTab.License} className="pt-3 overflow-y-auto h-full px-4">
          <SettingsLicense />
        </TabContent>
      </Tabs>
    </div>
  );
}
