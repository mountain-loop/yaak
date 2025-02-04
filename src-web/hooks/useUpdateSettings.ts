import type { Settings } from '@yaakapp-internal/models';
import { useSetAtom } from 'jotai';
import { invokeCmd } from '../lib/tauri';
import { useFastMutation } from './useFastMutation';
import { getSettings, settingsAtom } from './useSettings';

export function useUpdateSettings() {
  const setSettings = useSetAtom(settingsAtom);
  return useFastMutation<Settings, unknown, Partial<Settings>>({
    mutationKey: ['update_settings'],
    mutationFn: async (patch) => {
      const settings = getSettings();
      const newSettings: Settings = { ...settings, ...patch };
      return invokeCmd<Settings>('cmd_update_settings', { settings: newSettings });
    },
    onSuccess: (settings) => {
      setSettings(settings);
    },
  });
}
