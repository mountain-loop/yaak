import { invokeCmd } from '../lib/tauri';
import { useFastMutation } from './useFastMutation';

export function useInstallPlugin() {
  return useFastMutation<void, unknown, string>({
    mutationKey: ['install_plugin'],
    mutationFn: async (directory: string) => {
      await invokeCmd('cmd_install_plugin', { directory });
    },
  });
}
