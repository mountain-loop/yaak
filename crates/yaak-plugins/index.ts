import { platform } from "@yaakapp-internal/platform";
import { PluginNameVersion, PluginSearchResponse, PluginUpdatesResponse } from "./bindings/gen_api";

export * from "./bindings/gen_models";
export * from "./bindings/gen_events";
export * from "./bindings/gen_search";

export async function searchPlugins(query: string) {
  return platform.rpc<PluginSearchResponse>("cmd_plugins_search", { query });
}

export async function installPlugin(name: string, version: string | null) {
  return platform.rpc<void>("cmd_plugins_install", { name, version });
}

export async function uninstallPlugin(pluginId: string) {
  return platform.rpc<void>("cmd_plugins_uninstall", { pluginId });
}

export async function checkPluginUpdates() {
  return platform.rpc<PluginUpdatesResponse>("cmd_plugins_updates", {});
}

export async function updateAllPlugins() {
  return platform.rpc<PluginNameVersion[]>("cmd_plugins_update_all", {});
}

export async function installPluginFromDirectory(directory: string) {
  return platform.rpc<void>("cmd_plugins_install_from_directory", { directory });
}
