import {useMutation} from "@tanstack/react-query";
import type { Plugin } from '@yaakapp-internal/models';
import { atom, useAtomValue, useSetAtom } from 'jotai';
import { minPromiseMillis } from '../lib/minPromiseMillis';
import { listPlugins } from '../lib/store';
import { invokeCmd } from '../lib/tauri';

const plugins = await listPlugins();
export const pluginsAtom = atom<Plugin[]>(plugins);

export function usePlugins() {
  return useAtomValue(pluginsAtom);
}

export function usePluginsKey() {
  return useAtomValue(pluginsAtom)
    .map((p) => p.id + p.updatedAt)
    .join(',');
}

/**
 * Reload all plugins and refresh the list of plugins
 */
export function useRefreshPlugins() {
  const setPlugins = useSetAtom(pluginsAtom);
  return useMutation({
    mutationKey: ['refresh_plugins'],
    mutationFn: async () => {
      const plugins = await minPromiseMillis(
        (async function () {
          await invokeCmd('cmd_reload_plugins');
          return listPlugins();
        })(),
      );
      setPlugins(plugins);
    },
  });
}
