import { useFastMutation } from './useFastMutation';
import { trackEvent } from '../lib/analytics';
import { invokeCmd } from '../lib/tauri';

export function useInstallPlugin() {
  return useFastMutation<void, unknown, string>({
    mutationKey: ['install_plugin'],
    mutationFn: async (directory: string) => {
      await invokeCmd('cmd_install_plugin', { directory });
    },
    onSettled: () => trackEvent('plugin', 'create'),
  });
}
