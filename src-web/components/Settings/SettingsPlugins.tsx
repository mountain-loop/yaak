import { useMutation, useQuery } from '@tanstack/react-query';
import { openUrl } from '@tauri-apps/plugin-opener';
import type { Plugin } from '@yaakapp-internal/models';
import { patchModel, pluginsAtom } from '@yaakapp-internal/models';
import type { PluginVersion } from '@yaakapp-internal/plugins';
import {
  checkPluginUpdates,
  installPlugin,
  searchPlugins,
  uninstallPlugin,
} from '@yaakapp-internal/plugins';
import { useAtomValue } from 'jotai';
import { useState } from 'react';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { useInstallPlugin } from '../../hooks/useInstallPlugin';
import { usePluginInfo } from '../../hooks/usePluginInfo';
import { usePluginsKey, useRefreshPlugins } from '../../hooks/usePlugins';
import { appInfo } from '../../lib/appInfo';
import { showConfirmDelete } from '../../lib/confirm';
import { minPromiseMillis } from '../../lib/minPromiseMillis';
import { Button } from '../core/Button';
import { Checkbox } from '../core/Checkbox';
import { CountBadge } from '../core/CountBadge';
import { Icon } from '../core/Icon';
import { IconButton } from '../core/IconButton';
import { InlineCode } from '../core/InlineCode';
import { Link } from '../core/Link';
import { LoadingIcon } from '../core/LoadingIcon';
import { PlainInput } from '../core/PlainInput';
import { HStack } from '../core/Stacks';
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from '../core/Table';
import { TabContent, Tabs } from '../core/Tabs/Tabs';
import { EmptyStateText } from '../EmptyStateText';
import { SelectFile } from '../SelectFile';

function isPluginBundled(plugin: Plugin, vendoredPluginDir: string): boolean {
  const normalizedDir = plugin.directory.replace(/\\/g, '/');
  const normalizedVendoredDir = vendoredPluginDir.replace(/\\/g, '/');
  return (
    normalizedDir.includes(normalizedVendoredDir) ||
    normalizedDir.includes('vendored/plugins') ||
    normalizedDir.includes('/plugins/')
  );
}

interface SettingsPluginsProps {
  defaultSubtab?: string;
}

export function SettingsPlugins({ defaultSubtab }: SettingsPluginsProps) {
  const [directory, setDirectory] = useState<string | null>(null);
  const plugins = useAtomValue(pluginsAtom);
  const bundledPlugins = plugins.filter((p) => isPluginBundled(p, appInfo.vendoredPluginDir));
  const installedPlugins = plugins.filter((p) => !isPluginBundled(p, appInfo.vendoredPluginDir));
  const createPlugin = useInstallPlugin();
  const refreshPlugins = useRefreshPlugins();
  const [tab, setTab] = useState<string | undefined>(defaultSubtab);
  return (
    <div className="h-full">
      <Tabs
        value={tab}
        label="Plugins"
        onChangeValue={setTab}
        addBorders
        tabs={[
          { label: 'Discover', value: 'search' },
          {
            label: 'Installed',
            value: 'installed',
            rightSlot: <CountBadge count={installedPlugins.length} />,
          },
          {
            label: 'Bundled',
            value: 'bundled',
            rightSlot: <CountBadge count={bundledPlugins.length} />,
          },
        ]}
      >
        <TabContent value="search">
          <PluginSearch />
        </TabContent>
        <TabContent value="installed" className="pb-0">
          <div className="h-full grid grid-rows-[minmax(0,1fr)_auto]">
            <InstalledPlugins plugins={installedPlugins} />
            <footer className="grid grid-cols-[minmax(0,1fr)_auto] -mx-4 py-2 px-4 border-t bg-surface-highlight border-border-subtle min-w-0">
              <SelectFile
                size="xs"
                noun="Plugin"
                directory
                onChange={({ filePath }) => setDirectory(filePath)}
                filePath={directory}
              />
              <HStack>
                {directory && (
                  <Button
                    size="xs"
                    color="primary"
                    className="ml-auto"
                    onClick={() => {
                      if (directory == null) return;
                      createPlugin.mutate(directory);
                      setDirectory(null);
                    }}
                  >
                    Add Plugin
                  </Button>
                )}
                <IconButton
                  size="sm"
                  icon="refresh"
                  title="Reload plugins"
                  spin={refreshPlugins.isPending}
                  onClick={() => refreshPlugins.mutate()}
                />
                <IconButton
                  size="sm"
                  icon="help"
                  title="View documentation"
                  onClick={() =>
                    openUrl('https://feedback.yaak.app/help/articles/6911763-quick-start')
                  }
                />
              </HStack>
            </footer>
          </div>
        </TabContent>
        <TabContent value="bundled" className="pb-0">
          <BundledPlugins plugins={bundledPlugins} />
        </TabContent>
      </Tabs>
    </div>
  );
}

function PluginTableRowForInstalledPlugin({ plugin }: { plugin: Plugin }) {
  const info = usePluginInfo(plugin.id).data;
  if (info == null) {
    return null;
  }

  return (
    <PluginTableRow
      plugin={plugin}
      version={info.version}
      name={info.name}
      displayName={info.displayName}
      url={plugin.url}
      showCheckbox={true}
      showUninstall={true}
    />
  );
}

function PluginTableRowForBundledPlugin({ plugin }: { plugin: Plugin }) {
  const info = usePluginInfo(plugin.id).data;
  if (info == null) {
    return null;
  }

  return (
    <PluginTableRow
      plugin={plugin}
      version={info.version}
      name={info.name}
      displayName={info.displayName}
      url={plugin.url}
      showCheckbox={true}
      showUninstall={false}
    />
  );
}

function PluginTableRowForRemotePluginVersion({ pluginVersion }: { pluginVersion: PluginVersion }) {
  const plugin = useAtomValue(pluginsAtom).find((p) => p.id === pluginVersion.id);
  const pluginInfo = usePluginInfo(plugin?.id ?? null).data;

  return (
    <PluginTableRow
      plugin={plugin ?? null}
      version={pluginInfo?.version ?? pluginVersion.version}
      name={pluginVersion.name}
      displayName={pluginVersion.displayName}
      url={pluginVersion.url}
      showCheckbox={false}
    />
  );
}

function PluginTableRow({
  plugin,
  name,
  version,
  displayName,
  url,
  showCheckbox = true,
  showUninstall = true,
}: {
  plugin: Plugin | null;
  name: string;
  version: string;
  displayName: string;
  url: string | null;
  showCheckbox?: boolean;
  showUninstall?: boolean;
}) {
  const updates = usePluginUpdates();
  const latestVersion = updates.data?.plugins.find((u) => u.name === name)?.version;
  const installPluginMutation = useMutation({
    mutationKey: ['install_plugin', name],
    mutationFn: (name: string) => installPlugin(name, null),
  });
  const uninstall = usePromptUninstall(plugin?.id ?? null, displayName);
  const refreshPlugins = useRefreshPlugins();

  return (
    <TableRow>
      {showCheckbox && (
        <TableCell className="!py-0">
          <Checkbox
            hideLabel
            title={plugin?.enabled ? 'Disable plugin' : 'Enable plugin'}
            checked={plugin?.enabled ?? false}
            disabled={plugin == null}
            onChange={async (enabled) => {
              if (plugin) {
                await patchModel(plugin, { enabled });
                refreshPlugins.mutate();
              }
            }}
          />
        </TableCell>
      )}
      <TableCell className="font-semibold">
        {url ? (
          <Link noUnderline href={url}>
            {displayName}
          </Link>
        ) : (
          displayName
        )}
      </TableCell>
      <TableCell>
        <InlineCode>{name}</InlineCode>
      </TableCell>
      <TableCell>
        <HStack space={1.5}>
          <InlineCode>{version}</InlineCode>
          {latestVersion != null && (
            <InlineCode className="text-success flex items-center gap-1">
              <Icon icon="arrow_up" size="sm" />
              {latestVersion}
            </InlineCode>
          )}
        </HStack>
      </TableCell>
      <TableCell className="!py-0">
        <HStack justifyContent="end" space={1.5}>
          {plugin != null && latestVersion != null ? (
            <Button
              variant="border"
              color="success"
              title={`Update to ${latestVersion}`}
              size="xs"
              isLoading={installPluginMutation.isPending}
              onClick={() => installPluginMutation.mutate(name)}
            >
              Update
            </Button>
          ) : plugin == null ? (
            <Button
              variant="border"
              color="primary"
              title={`Install ${version}`}
              size="xs"
              isLoading={installPluginMutation.isPending}
              onClick={() => installPluginMutation.mutate(name)}
            >
              Install
            </Button>
          ) : null}
          {showUninstall && uninstall != null && (
            <Button
              size="xs"
              title="Uninstall plugin"
              variant="border"
              isLoading={uninstall.isPending}
              onClick={() => uninstall.mutate()}
            >
              Uninstall
            </Button>
          )}
        </HStack>
      </TableCell>
    </TableRow>
  );
}

function PluginSearch() {
  const [query, setQuery] = useState<string>('');
  const debouncedQuery = useDebouncedValue(query);
  const results = useQuery({
    queryKey: ['plugins', debouncedQuery],
    queryFn: () => searchPlugins(query),
  });

  return (
    <div className="h-full grid grid-rows-[auto_minmax(0,1fr)] gap-3">
      <HStack space={1.5}>
        <PlainInput
          hideLabel
          label="Search"
          placeholder="Search plugins..."
          onChange={setQuery}
          defaultValue={query}
        />
      </HStack>
      <div className="w-full h-full">
        {results.data == null ? (
          <EmptyStateText>
            <LoadingIcon size="xl" className="text-text-subtlest" />
          </EmptyStateText>
        ) : (results.data.plugins ?? []).length === 0 ? (
          <EmptyStateText>No plugins found</EmptyStateText>
        ) : (
          <Table scrollable>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Display Name</TableHeaderCell>
                <TableHeaderCell>Name</TableHeaderCell>
                <TableHeaderCell>Version</TableHeaderCell>
                <TableHeaderCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {results.data.plugins.map((p) => (
                <PluginTableRowForRemotePluginVersion key={p.id} pluginVersion={p} />
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}

function InstalledPlugins({ plugins }: { plugins: Plugin[] }) {
  return plugins.length === 0 ? (
    <div className="pb-4">
      <EmptyStateText className="text-center">
        Plugins extend the functionality of Yaak.
        <br />
        Add your first plugin to get started.
      </EmptyStateText>
    </div>
  ) : (
    <Table scrollable>
      <TableHead>
        <TableRow>
          <TableHeaderCell className="w-0" />
          <TableHeaderCell>Display Name</TableHeaderCell>
          <TableHeaderCell>Name</TableHeaderCell>
          <TableHeaderCell>Version</TableHeaderCell>
          <TableHeaderCell />
        </TableRow>
      </TableHead>
      <tbody className="divide-y divide-surface-highlight">
        {plugins.map((p) => (
          <PluginTableRowForInstalledPlugin key={p.id} plugin={p} />
        ))}
      </tbody>
    </Table>
  );
}

function BundledPlugins({ plugins }: { plugins: Plugin[] }) {
  return plugins.length === 0 ? (
    <div className="pb-4">
      <EmptyStateText className="text-center">No bundled plugins found.</EmptyStateText>
    </div>
  ) : (
    <Table scrollable>
      <TableHead>
        <TableRow>
          <TableHeaderCell className="w-0" />
          <TableHeaderCell>Display Name</TableHeaderCell>
          <TableHeaderCell>Name</TableHeaderCell>
          <TableHeaderCell>Version</TableHeaderCell>
          <TableHeaderCell />
        </TableRow>
      </TableHead>
      <tbody className="divide-y divide-surface-highlight">
        {plugins.map((p) => (
          <PluginTableRowForBundledPlugin key={p.id} plugin={p} />
        ))}
      </tbody>
    </Table>
  );
}

function usePromptUninstall(pluginId: string | null, name: string) {
  const mut = useMutation({
    mutationKey: ['uninstall_plugin', pluginId],
    mutationFn: async () => {
      if (pluginId == null) return;

      const confirmed = await showConfirmDelete({
        id: `uninstall-plugin-${pluginId}`,
        title: 'Uninstall Plugin',
        confirmText: 'Uninstall',
        description: (
          <>
            Permanently uninstall <InlineCode>{name}</InlineCode>?
          </>
        ),
      });
      if (confirmed) {
        await minPromiseMillis(uninstallPlugin(pluginId), 700);
      }
    },
  });

  return pluginId == null ? null : mut;
}

function usePluginUpdates() {
  return useQuery({
    queryKey: ['plugin_updates', usePluginsKey()],
    queryFn: () => checkPluginUpdates(),
  });
}
