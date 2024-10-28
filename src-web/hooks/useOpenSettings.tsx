import { useMutation } from '@tanstack/react-query';
import { invokeCmd } from '../lib/tauri';
import { useActiveWorkspace } from './useActiveWorkspace';
import { useAppRoutes } from './useAppRoutes';

export function useOpenSettings() {
  const routes = useAppRoutes();
  const workspace = useActiveWorkspace();
  return useMutation({
    mutationKey: ['open_settings'],
    mutationFn: async () => {
      if (workspace == null) return;

      await invokeCmd('cmd_new_child_window', {
        url: routes.paths.workspaceSettings({
          workspaceId: workspace.id,
          cookieJarId: null,
          environmentId: null,
        }),
        label: 'settings',
        title: 'Yaak Settings',
        innerSize: [600, 550],
      });
    },
  });
}
