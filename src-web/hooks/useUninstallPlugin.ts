import { invokeCmd } from '../lib/tauri';
import { useFastMutation } from './useFastMutation';

export function useUninstallPlugin() {
  return useFastMutation({
    mutationKey: ['uninstall_plugin'],
    mutationFn: async (pluginId: string) => {
      return invokeCmd('cmd_uninstall_plugin', { pluginId });
    },
  });
}
