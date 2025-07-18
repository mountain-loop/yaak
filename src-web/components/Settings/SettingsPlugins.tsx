import { useMutation, useQuery } from '@tanstack/react-query';
import { openUrl } from '@tauri-apps/plugin-opener';
import type { Plugin } from '@yaakapp-internal/models';
import { pluginsAtom } from '@yaakapp-internal/models';
import type { PluginVersion } from '@yaakapp-internal/plugins';
import {
  checkPluginUpdates,
  installPlugin,
  searchPlugins,
  uninstallPlugin,
} from '@yaakapp-internal/plugins';
import type { PluginUpdatesResponse } from '@yaakapp-internal/plugins/bindings/gen_api';
import { useAtomValue } from 'jotai';
import React, { useState } from 'react';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { useInstallPlugin } from '../../hooks/useInstallPlugin';
import { usePluginInfo } from '../../hooks/usePluginInfo';
import { useRefreshPlugins } from '../../hooks/usePlugins';
import { showConfirmDelete } from '../../lib/confirm';
import { minPromiseMillis } from '../../lib/minPromiseMillis';
import { Button } from '../core/Button';
import { CountBadge } from '../core/CountBadge';
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

export function SettingsPlugins() {
  const [directory, setDirectory] = React.useState<string | null>(null);
  const plugins = useAtomValue(pluginsAtom);
  const createPlugin = useInstallPlugin();
  const refreshPlugins = useRefreshPlugins();
  const [tab, setTab] = useState<string>();
  return (
    <div className="h-full">
      <Tabs
        value={tab}
        label="Plugins"
        onChangeValue={setTab}
        addBorders
        tabListClassName="!-ml-3"
        tabs={[
          { label: 'Marketplace', value: 'search' },
          {
            label: 'Installed',
            value: 'installed',
            rightSlot: <CountBadge count={plugins.length} />,
          },
        ]}
      >
        <TabContent value="search">
          <PluginSearch />
        </TabContent>
        <TabContent value="installed">
          <div className="h-full grid grid-rows-[minmax(0,1fr)_auto]">
            <InstalledPlugins />
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
      </Tabs>
    </div>
  );
}

function PluginTableRow({
  plugin,
  updates,
}: {
  plugin: Plugin;
  updates: PluginUpdatesResponse | null;
}) {
  const pluginInfo = usePluginInfo(plugin.id);
  const latestVersion = updates?.plugins.find((u) => u.name === pluginInfo.data?.name)?.version;
  const installPluginMutation = useMutation({
    mutationKey: ['install_plugin', plugin.id],
    mutationFn: (name: string) => installPlugin(name, null),
  });

  const displayName = pluginInfo.data?.displayName ?? 'Unknown';
  const uninstallPluginMutation = usePromptUninstall(plugin.id, displayName);

  if (pluginInfo.isPending) {
    return null;
  }

  return (
    <TableRow>
      <TableCell className="font-semibold">
        {plugin.url ? (
          <Link noUnderline href={plugin.url}>
            {displayName}
          </Link>
        ) : (
          displayName
        )}
      </TableCell>
      <TableCell>
        <InlineCode>{pluginInfo.data?.version ?? 'n/a'}</InlineCode>
      </TableCell>
      <TableCell>
        <HStack justifyContent="end">
          {pluginInfo.data && latestVersion != null && (
            <Button
              variant="border"
              color="success"
              title={`Update to ${latestVersion}`}
              size="xs"
              isLoading={installPluginMutation.isPending}
              onClick={() => installPluginMutation.mutate(pluginInfo.data.name)}
            >
              Update
            </Button>
          )}
          <Button
            size="xs"
            title="Uninstall plugin"
            variant="border"
            isLoading={uninstallPluginMutation.isPending}
            onClick={async () => {
              uninstallPluginMutation.mutate();
            }}
          >
            Uninstall
          </Button>
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
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Name</TableHeaderCell>
                <TableHeaderCell>Version</TableHeaderCell>
                <TableHeaderCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {results.data.plugins.map((plugin) => (
                <TableRow key={plugin.id}>
                  <TableCell className="font-semibold">
                    <Link noUnderline href={plugin.url}>
                      {plugin.displayName}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <InlineCode>{plugin.version}</InlineCode>
                  </TableCell>
                  <TableCell className="w-[6rem]">
                    <InstallPluginButton pluginVersion={plugin} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}

function InstallPluginButton({ pluginVersion }: { pluginVersion: PluginVersion }) {
  const plugins = useAtomValue(pluginsAtom);
  const installed = plugins?.some((p) => p.id === pluginVersion.id);
  const uninstallPluginMutation = usePromptUninstall(pluginVersion.id, pluginVersion.displayName);
  const installPluginMutation = useMutation({
    mutationKey: ['install_plugin', pluginVersion.id],
    mutationFn: (pv: PluginVersion) => installPlugin(pv.name, null),
  });

  return (
    <Button
      size="xs"
      variant="border"
      color={installed ? 'default' : 'primary'}
      className="ml-auto"
      isLoading={installPluginMutation.isPending || uninstallPluginMutation.isPending}
      onClick={async () => {
        if (installed) {
          uninstallPluginMutation.mutate();
        } else {
          installPluginMutation.mutate(pluginVersion);
        }
      }}
    >
      {installed ? 'Uninstall' : 'Install'}
    </Button>
  );
}

function InstalledPlugins() {
  const plugins = useAtomValue(pluginsAtom);
  const updates = useQuery({
    queryKey: ['plugin_updates'],
    queryFn: () => checkPluginUpdates(),
  });

  return plugins.length === 0 ? (
    <div className="pb-4">
      <EmptyStateText className="text-center">
        Plugins extend the functionality of Yaak.
        <br />
        Add your first plugin to get started.
      </EmptyStateText>
    </div>
  ) : (
    <Table>
      <TableHead>
        <TableRow>
          <TableHeaderCell>Name</TableHeaderCell>
          <TableHeaderCell>Version</TableHeaderCell>
          <TableHeaderCell />
        </TableRow>
      </TableHead>
      <tbody className="divide-y divide-surface-highlight">
        {plugins.map((p) => {
          return <PluginTableRow key={p.id} plugin={p} updates={updates.data ?? null} />;
        })}
      </tbody>
    </Table>
  );
}

function usePromptUninstall(pluginId: string, name: string) {
  return useMutation({
    mutationKey: ['uninstall_plugin', pluginId],
    mutationFn: async () => {
      const confirmed = await showConfirmDelete({
        id: 'uninstall-plugin-' + pluginId,
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
}
