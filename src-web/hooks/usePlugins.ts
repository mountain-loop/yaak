import { useMutation } from '@tanstack/react-query';
import { changeModelStoreWorkspace, pluginsAtom } from '@yaakapp-internal/models';
import { useAtomValue } from 'jotai';
import { jotaiStore } from '../lib/jotai';
import { minPromiseMillis } from '../lib/minPromiseMillis';
import { invokeCmd } from '../lib/tauri';
import { activeWorkspaceIdAtom } from './useActiveWorkspace';
import { invalidateAllPluginInfo } from './usePluginInfo';

export function usePluginsKey() {
  return useAtomValue(pluginsAtom)
    .map((p) => p.id + p.updatedAt)
    .join(',');
}

/**
 * Reload all plugins and refresh the list of plugins
 */
export function useRefreshPlugins() {
  return useMutation({
    mutationKey: ['refresh_plugins'],
    mutationFn: async () => {
      await minPromiseMillis(
        (async function () {
          await invokeCmd('cmd_reload_plugins');
          const workspaceId = jotaiStore.get(activeWorkspaceIdAtom);
          await changeModelStoreWorkspace(workspaceId); // Force refresh models
          invalidateAllPluginInfo();
        })(),
      );
    },
  });
}
