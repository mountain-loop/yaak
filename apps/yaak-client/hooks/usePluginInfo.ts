import { useQueries, useQuery } from "@tanstack/react-query";
import type { Plugin } from "@yaakapp-internal/models";
import { pluginsAtom } from "@yaakapp-internal/models";
import type { PluginMetadata } from "@yaakapp-internal/plugins";
import { useAtomValue } from "jotai";
import { queryClient } from "../lib/queryClient";
import { rpc } from "../lib/rpc";

function pluginInfoKey(id: string | null, plugin: Plugin | null) {
  return ["plugin_info", id ?? "n/a", plugin?.updatedAt ?? "n/a"];
}

export function usePluginInfo(id: string | null) {
  const plugins = useAtomValue(pluginsAtom);
  // Get the plugin so we can refetch whenever it's updated
  const plugin = plugins.find((p) => p.id === id);
  return useQuery({
    queryKey: pluginInfoKey(id, plugin ?? null),
    placeholderData: (prev) => prev, // Keep previous data on refetch
    queryFn: () => {
      if (id == null) return null;
      return rpc<PluginMetadata>("cmd_plugin_info", { id });
    },
  });
}

/** Every plugin with its metadata, once loaded; the ones still loading are left out. */
export function usePluginInfos() {
  const plugins = useAtomValue(pluginsAtom);
  return useQueries({
    queries: plugins.map((plugin) => ({
      queryKey: pluginInfoKey(plugin.id, plugin),
      queryFn: () => rpc<PluginMetadata>("cmd_plugin_info", { id: plugin.id }),
    })),
    combine: (results) =>
      results.flatMap((result, i) => {
        const plugin = plugins[i];
        return result.data == null || plugin == null ? [] : [{ plugin, info: result.data }];
      }),
  });
}

export function invalidateAllPluginInfo() {
  queryClient.invalidateQueries({ queryKey: ["plugin_info"] }).catch(console.error);
}
