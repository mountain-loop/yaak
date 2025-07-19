import { useSearch } from '@tanstack/react-router';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { type } from '@tauri-apps/plugin-os';
import classNames from 'classnames';
import React, { useState } from 'react';
import { useKeyPressEvent } from 'react-use';
import { capitalize } from '../../lib/capitalize';
import { HStack } from '../core/Stacks';
import { TabContent, Tabs } from '../core/Tabs/Tabs';
import { HeaderSize } from '../HeaderSize';
import { SettingsInterface } from './SettingsInterface';
import { SettingsGeneral } from './SettingsGeneral';
import { SettingsLicense } from './SettingsLicense';
import { SettingsPlugins } from './SettingsPlugins';
import { SettingsProxy } from './SettingsProxy';
import { SettingsTheme } from './SettingsTheme';

interface Props {
  hide?: () => void;
}

const TAB_GENERAL = 'general';
const TAB_INTERFACE = 'interface';
const TAB_THEME = 'theme';
const TAB_PROXY = 'proxy';
const TAB_PLUGINS = 'plugins';
const TAB_LICENSE = 'license';
const tabs = [TAB_GENERAL, TAB_THEME, TAB_INTERFACE, TAB_PROXY, TAB_PLUGINS, TAB_LICENSE] as const;
export type SettingsTab = (typeof tabs)[number];

export default function Settings({ hide }: Props) {
  const { tab: tabFromQuery } = useSearch({ from: '/workspaces/$workspaceId/settings' });
  const [tab, setTab] = useState<string | undefined>(tabFromQuery);

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
            <div className={classNames(type() === 'macos' ? 'text-center' : 'pl-2')}>Settings</div>
          </HStack>
        </HeaderSize>
      )}
      <Tabs
        layout="horizontal"
        value={tab}
        addBorders
        tabListClassName="min-w-[10rem] bg-surface x-theme-sidebar border-r border-border"
        label="Settings"
        onChangeValue={setTab}
        tabs={tabs.map((value) => ({ value, label: capitalize(value) }))}
      >
        <TabContent value={TAB_GENERAL} className="overflow-y-auto h-full px-4">
          <SettingsGeneral />
        </TabContent>
        <TabContent value={TAB_INTERFACE} className="overflow-y-auto h-full px-4">
          <SettingsInterface />
        </TabContent>
        <TabContent value={TAB_THEME} className="overflow-y-auto h-full px-4">
          <SettingsTheme />
        </TabContent>
        <TabContent value={TAB_PLUGINS} className="h-full px-4 grid grid-rows-1">
          <SettingsPlugins />
        </TabContent>
        <TabContent value={TAB_PROXY} className="overflow-y-auto h-full px-4">
          <SettingsProxy />
        </TabContent>
        <TabContent value={TAB_LICENSE} className="overflow-y-auto h-full px-4">
          <SettingsLicense />
        </TabContent>
      </Tabs>
    </div>
  );
}
