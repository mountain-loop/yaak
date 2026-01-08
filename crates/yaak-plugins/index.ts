import { invoke } from '@tauri-apps/api/core';
import { PluginNameVersion, PluginSearchResponse, PluginUpdatesResponse } from './bindings/gen_api';

export * from './bindings/gen_models';
export * from './bindings/gen_events';
export * from './bindings/gen_search';

export async function searchPlugins(query: string) {
  return invoke<PluginSearchResponse>('cmd_plugins_search', { query });
}

export async function installPlugin(name: string, version: string | null) {
  return invoke<void>('cmd_plugins_install', { name, version });
}

export async function uninstallPlugin(pluginId: string) {
  return invoke<void>('cmd_plugins_uninstall', { pluginId });
}

export async function checkPluginUpdates() {
  return invoke<PluginUpdatesResponse>('cmd_plugins_updates', {});
}

export async function updateAllPlugins() {
  return invoke<PluginNameVersion[]>('cmd_plugins_update_all', {});
}
