import { useSearch } from '@tanstack/react-router';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { type } from '@tauri-apps/plugin-os';
import { useLicense } from '@yaakapp-internal/license';
import { pluginsAtom, settingsAtom } from '@yaakapp-internal/models';
import classNames from 'classnames';
import { useAtomValue } from 'jotai';
import { useState } from 'react';
import { useKeyPressEvent } from 'react-use';
import { appInfo } from '../../lib/appInfo';
import { capitalize } from '../../lib/capitalize';
import { CountBadge } from '../core/CountBadge';
import { HStack } from '../core/Stacks';
import { TabContent, type TabItem, Tabs } from '../core/Tabs/Tabs';
import { HeaderSize } from '../HeaderSize';
import { SettingsCertificates } from './SettingsCertificates';
import { SettingsGeneral } from './SettingsGeneral';
import { SettingsInterface } from './SettingsInterface';
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
const TAB_CERTIFICATES = 'certificates';
const TAB_PLUGINS = 'plugins';
const TAB_LICENSE = 'license';
const tabs = [
  TAB_GENERAL,
  TAB_THEME,
  TAB_INTERFACE,
  TAB_CERTIFICATES,
  TAB_PROXY,
  TAB_PLUGINS,
  TAB_LICENSE,
] as const;
export type SettingsTab = (typeof tabs)[number];

export default function Settings({ hide }: Props) {
  const { tab: tabFromQuery } = useSearch({ from: '/workspaces/$workspaceId/settings' });
  // Parse tab and subtab (e.g., "plugins:installed")
  const [mainTab, subtab] = tabFromQuery?.split(':') ?? [];
  const [tab, setTab] = useState<string | undefined>(mainTab || tabFromQuery);
  const settings = useAtomValue(settingsAtom);
  const plugins = useAtomValue(pluginsAtom);
  const licenseCheck = useLicense();

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
        tabListClassName="min-w-[10rem] bg-surface x-theme-sidebar border-r border-border pl-3"
        label="Settings"
        onChangeValue={setTab}
        tabs={tabs.map(
          (value): TabItem => ({
            value,
            label: capitalize(value),
            hidden: !appInfo.featureLicense && value === TAB_LICENSE,
            rightSlot:
              value === TAB_CERTIFICATES ? (
                <CountBadge count={settings.clientCertificates.length} />
              ) : value === TAB_PLUGINS ? (
                <CountBadge count={plugins.length} />
              ) : value === TAB_PROXY && settings.proxy?.type === 'enabled' ? (
                <CountBadge count />
              ) : value === TAB_LICENSE && licenseCheck.check.data?.status === 'personal_use' ? (
                <CountBadge count color="notice" />
              ) : null,
          }),
        )}
      >
        <TabContent value={TAB_GENERAL} className="overflow-y-auto h-full px-6 !py-4">
          <SettingsGeneral />
        </TabContent>
        <TabContent value={TAB_INTERFACE} className="overflow-y-auto h-full px-6 !py-4">
          <SettingsInterface />
        </TabContent>
        <TabContent value={TAB_THEME} className="overflow-y-auto h-full px-6 !py-4">
          <SettingsTheme />
        </TabContent>
        <TabContent value={TAB_PLUGINS} className="h-full grid grid-rows-1 px-6 !py-4">
          <SettingsPlugins defaultSubtab={tab === TAB_PLUGINS ? subtab : undefined} />
        </TabContent>
        <TabContent value={TAB_PROXY} className="overflow-y-auto h-full px-6 !py-4">
          <SettingsProxy />
        </TabContent>
        <TabContent value={TAB_CERTIFICATES} className="overflow-y-auto h-full px-6 !py-4">
          <SettingsCertificates />
        </TabContent>
        <TabContent value={TAB_LICENSE} className="overflow-y-auto h-full px-6 !py-4">
          <SettingsLicense />
        </TabContent>
      </Tabs>
    </div>
  );
}
