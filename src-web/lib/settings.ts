import { invoke } from '@tauri-apps/api/core';
import type { Settings } from '@yaakapp-internal/models';

export function getSettings(): Promise<Settings> {
  return invoke<Settings>('plugin:yaak-models|get_settings');
}
