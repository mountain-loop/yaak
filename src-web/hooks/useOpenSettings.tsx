import { useMutation } from '@tanstack/react-query';
import { SettingsTab } from '../components/Settings/Settings';
import { trackEvent } from '../lib/analytics';
import { invokeCmd } from '../lib/tauri';
import { useActiveWorkspace } from './useActiveWorkspace';
import { useAppRoutes } from './useAppRoutes';

export function useOpenSettings(tab = SettingsTab.General) {
  const routes = useAppRoutes();
  const workspace = useActiveWorkspace();
  return useMutation({
    mutationKey: ['open_settings'],
    mutationFn: async () => {
      if (workspace == null) return;

      trackEvent('dialog', 'show', { id: 'settings', tab: `${tab}` });
      await invokeCmd('cmd_new_child_window', {
        url: routes.paths.workspaceSettings({ workspaceId: workspace.id, tab }),
        label: 'settings',
        title: 'Yaak Settings',
        innerSize: [600, 550],
      });
    },
  });
}
