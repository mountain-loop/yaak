import { invoke } from '@tauri-apps/api/core';
import type { Settings } from '@yaakapp-internal/models';

export function getSettings(): Promise<Settings> {
  return invoke<Settings>('models_get_settings');
}
