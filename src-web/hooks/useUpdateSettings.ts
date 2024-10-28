import { useMutation } from '@tanstack/react-query';
import type { Settings } from '@yaakapp-internal/models';
import { useSetAtom } from 'jotai';
import { getSettings } from '../lib/store';
import { invokeCmd } from '../lib/tauri';
import { settingsAtom } from './useSettings';

export function useUpdateSettings() {
  const setSettings = useSetAtom(settingsAtom);
  return useMutation<Settings, unknown, Partial<Settings>>({
    mutationKey: ['update_settings'],
    mutationFn: async (patch) => {
      const settings = await getSettings();
      const newSettings: Settings = { ...settings, ...patch };
      return invokeCmd<Settings>('cmd_update_settings', { settings: newSettings });
    },
    onSuccess: (settings) => {
      setSettings(settings);
    },
  });
}
