import { useQuery } from '@tanstack/react-query';
import type { BootResponse } from '@yaakapp-internal/plugins';
import { invokeCmd } from '../lib/tauri';

export function usePluginInfo(id: string) {
  return useQuery({
    queryKey: ['plugin_info', id],
    queryFn: async () => {
      const info = (await invokeCmd('cmd_plugin_info', { id })) as BootResponse;
      return info;
    },
  });
}
