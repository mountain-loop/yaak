import { useMutation } from '@tanstack/react-query';
import { changeModelStoreWorkspace, listModels, pluginsAtom } from '@yaakapp-internal/models';
import { useAtomValue } from 'jotai';
import { jotaiStore } from '../lib/jotai';
import { minPromiseMillis } from '../lib/minPromiseMillis';
import { invokeCmd } from '../lib/tauri';
import { activeWorkspaceIdAtom } from './useActiveWorkspace';

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
          // A hacky way to force the plugins to refresh
          await changeModelStoreWorkspace(workspaceId);
          return listModels('plugin');
        })(),
      );
    },
  });
}
