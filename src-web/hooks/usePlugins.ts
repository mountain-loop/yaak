import { useMutation } from '@tanstack/react-query';
import { changeModelStoreWorkspace, pluginsAtom } from '@yaakapp-internal/models';
import { useAtomValue } from 'jotai';
import { jotaiStore } from '../lib/jotai';
import { minPromiseMillis } from '../lib/minPromiseMillis';
import { invokeCmd } from '../lib/tauri';
import { activeWorkspaceIdAtom } from './useActiveWorkspace';
import { useDebouncedValue } from './useDebouncedValue';
import { invalidateAllPluginInfo } from './usePluginInfo';

export function usePluginsKey() {
  const pluginKey = useAtomValue(pluginsAtom)
    .map((p) => p.id + p.updatedAt)
    .join(',');

  // Debounce plugins both for efficiency and to give plugins a chance to reload after the DB updates
  return useDebouncedValue(pluginKey, 1000);
}

/**
 * Reload all plugins and refresh the list of plugins
 */
export function useRefreshPlugins() {
  return useMutation({
    mutationKey: ['refresh_plugins'],
    mutationFn: async () => {
      await minPromiseMillis(
        (async () => {
          await invokeCmd('cmd_reload_plugins');
          const workspaceId = jotaiStore.get(activeWorkspaceIdAtom);
          await changeModelStoreWorkspace(workspaceId); // Force refresh models
          invalidateAllPluginInfo();
        })(),
      );
    },
  });
}
