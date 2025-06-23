import { useQuery } from '@tanstack/react-query';
import type { Plugin } from '@yaakapp-internal/models';
import { pluginsAtom } from '@yaakapp-internal/models';
import type { PluginMetadata } from '@yaakapp-internal/plugins';
import { useAtomValue } from 'jotai';
import { queryClient } from '../lib/queryClient';
import { invokeCmd } from '../lib/tauri';

function pluginInfoKey(id: string, plugin: Plugin | null) {
  return ['plugin_info', id, plugin?.updatedAt ?? 'n/a'];
}

export function usePluginInfo(id: string) {
  const plugins = useAtomValue(pluginsAtom);
  // Get the plugin so we can refetch whenever it's updated
  const plugin = plugins.find((p) => p.id === id);
  return useQuery({
    queryKey: pluginInfoKey(id, plugin ?? null),
    placeholderData: (prev) => prev, // Keep previous data on refetch
    queryFn: () => invokeCmd<PluginMetadata>('cmd_plugin_info', { id }),
  });
}

export function invalidateAllPluginInfo() {
  queryClient.invalidateQueries({ queryKey: ['plugin_info'] }).catch(console.error);
}
