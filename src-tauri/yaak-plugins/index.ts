import { invoke } from '@tauri-apps/api/core';
import { PluginSearchResponse, PluginVersion } from './bindings/gen_search';

export * from './bindings/gen_models';
export * from './bindings/gen_events';
export * from './bindings/gen_search';

export async function searchPlugins(query: string) {
  return invoke<PluginSearchResponse>('plugin:yaak-plugins|search', { query });
}

export async function installPlugin(plugin: PluginVersion) {
  return invoke<string>('plugin:yaak-plugins|install', { plugin });
}
