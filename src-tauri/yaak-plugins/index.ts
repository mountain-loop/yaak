import { invoke } from '@tauri-apps/api/core';
import { PluginSearchResponse, PluginUpdatesResponse } from './bindings/gen_api';

export * from './bindings/gen_models';
export * from './bindings/gen_events';
export * from './bindings/gen_search';

export async function searchPlugins(query: string) {
  return invoke<PluginSearchResponse>('plugin:yaak-plugins|search', { query });
}

export async function installPlugin(name: string, version: string | null) {
  return invoke<string>('plugin:yaak-plugins|install', { name, version });
}

export async function uninstallPlugin(pluginId: string) {
  return invoke<string>('plugin:yaak-plugins|uninstall', { pluginId });
}

export async function checkPluginUpdates() {
  return invoke<PluginUpdatesResponse>('plugin:yaak-plugins|updates', {});
}
