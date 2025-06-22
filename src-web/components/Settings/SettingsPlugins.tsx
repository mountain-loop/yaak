import { useMutation, useQuery } from '@tanstack/react-query';
import { openUrl } from '@tauri-apps/plugin-opener';
import type { Plugin } from '@yaakapp-internal/models';
import { pluginsAtom } from '@yaakapp-internal/models';
import { installPlugin, PluginVersion, searchPlugins } from '@yaakapp-internal/plugins';
import { useAtomValue } from 'jotai';
import React, { useState } from 'react';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { useInstallPlugin } from '../../hooks/useInstallPlugin';
import { usePluginInfo } from '../../hooks/usePluginInfo';
import { useRefreshPlugins } from '../../hooks/usePlugins';
import { useUninstallPlugin } from '../../hooks/useUninstallPlugin';
import { Button } from '../core/Button';
import { IconButton } from '../core/IconButton';
import { InlineCode } from '../core/InlineCode';
import { LoadingIcon } from '../core/LoadingIcon';
import { PlainInput } from '../core/PlainInput';
import { HStack } from '../core/Stacks';
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from '../core/Table';
import { TabContent, Tabs } from '../core/Tabs/Tabs';
import { EmptyStateText } from '../EmptyStateText';
import { SelectFile } from '../SelectFile';

export function SettingsPlugins() {
  const [directory, setDirectory] = React.useState<string | null>(null);
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
          { label: 'Installed', value: 'installed' },
        ]}
      >
        <TabContent value="search">
          <PluginSearch />
        </TabContent>
        <TabContent value="installed">
          <InstalledPlugins />
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (directory == null) return;
              createPlugin.mutate(directory);
              setDirectory(null);
            }}
          >
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
                  <Button size="xs" type="submit" color="primary" className="ml-auto">
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
          </form>
        </TabContent>
      </Tabs>
    </div>
  );
}

function PluginInfo({ plugin }: { plugin: Plugin }) {
  const pluginInfo = usePluginInfo(plugin.id);
  const deletePlugin = useUninstallPlugin();
  return (
    <tr className="group">
      <td className="py-2 select-text cursor-text w-full">{pluginInfo.data?.name}</td>
      <td className="py-2 select-text cursor-text text-right">
        <InlineCode>{pluginInfo.data?.version}</InlineCode>
      </td>
      <td className="py-2 select-text cursor-text pl-2">
        <IconButton
          size="sm"
          icon="trash"
          title="Uninstall plugin"
          onClick={() => deletePlugin.mutate(plugin.id)}
        />
      </td>
    </tr>
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
      <div className="w-full h-full overflow-auto">
        {results.data == null ? (
          <EmptyStateText>
            <LoadingIcon size="xl" className="text-text-subtlest" />
          </EmptyStateText>
        ) : (results.data.results ?? []).length === 0 ? (
          <EmptyStateText>No plugins found</EmptyStateText>
        ) : (
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Name</TableHeaderCell>
                <TableHeaderCell>Version</TableHeaderCell>
                <TableHeaderCell>Description</TableHeaderCell>
                <TableHeaderCell children="" />
              </TableRow>
            </TableHead>
            <TableBody>
              {results.data.results.map((plugin) => {
                return (
                  <TableRow key={plugin.id}>
                    <TableCell className="font-semibold">{plugin.displayName}</TableCell>
                    <TableCell className="text-text-subtle">
                      <InlineCode>{plugin.version}</InlineCode>
                    </TableCell>
                    <TableCell className="w-full text-text-subtle">
                      {plugin.description ?? 'n/a'}
                    </TableCell>
                    <TableCell>
                      <InstallPluginButton plugin={plugin} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}

function InstallPluginButton({ plugin }: { plugin: PluginVersion }) {
  const plugins = useAtomValue(pluginsAtom);
  const deletePlugin = useUninstallPlugin();
  const installed = plugins?.some((p) => p.id === plugin.id);
  const installPluginMutation = useMutation({
    mutationKey: ['install_plugin', plugin.id],
    mutationFn: installPlugin,
  });

  return (
    <Button
      size="xs"
      variant={installed ? 'solid' : 'border'}
      color={installed ? 'primary' : 'secondary'}
      className="ml-auto"
      isLoading={installPluginMutation.isPending}
      onClick={async () => {
        if (installed) {
          deletePlugin.mutate(plugin.id);
        } else {
          installPluginMutation.mutate(plugin);
        }
      }}
    >
      {installed ? 'Uninstall' : 'Install'}
    </Button>
  );
}

function InstalledPlugins() {
  const plugins = useAtomValue(pluginsAtom);
  return plugins.length === 0 ? (
    <div className="pb-4">
      <EmptyStateText className="text-center">
        Plugins extend the functionality of Yaak.
        <br />
        Add your first plugin to get started.
      </EmptyStateText>
    </div>
  ) : (
    <table className="w-full text-sm mb-auto min-w-full max-w-full divide-y divide-surface-highlight">
      <thead>
        <tr>
          <th className="py-2 text-left">Plugin</th>
          <th className="py-2 text-right">Version</th>
          <th></th>
        </tr>
      </thead>
      <tbody className="divide-y divide-surface-highlight">
        {plugins.map((p) => (
          <PluginInfo key={p.id} plugin={p} />
        ))}
      </tbody>
    </table>
  );
}
