import { useQuery } from '@tanstack/react-query';
import type { BootResponse } from '@yaakapp-internal/plugins';
import { queryClient } from '../lib/queryClient';
import { invokeCmd } from '../lib/tauri';

function pluginInfoKey(id: string) {
  return ['plugin_info', id];
}

export function usePluginInfo(id: string) {
  return useQuery({
    queryKey: pluginInfoKey(id),
    queryFn: () => invokeCmd<BootResponse>('cmd_plugin_info', { id }),
  });
}

export function invalidateAllPluginInfo() {
  queryClient.invalidateQueries({ queryKey: ['plugin_info'] }).catch(console.error);
}
