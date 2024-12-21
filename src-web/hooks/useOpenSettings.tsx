import { useMutation } from './useMutation';
import { SettingsTab } from '../components/Settings/Settings';
import { trackEvent } from '../lib/analytics';
import { invokeCmd } from '../lib/tauri';
import { router } from '../main';
import { Route as SettingsRoute } from '../routes/workspaces/settings';
import { useActiveWorkspace } from './useActiveWorkspace';

export function useOpenSettings(tab = SettingsTab.General) {
  const workspace = useActiveWorkspace();

  return useMutation({
    mutationKey: ['open_settings'],
    mutationFn: async () => {
      if (workspace == null) return;

      trackEvent('dialog', 'show', { id: 'settings', tab: `${tab}` });
      const location = router.buildLocation({
        to: SettingsRoute.fullPath,
        params: { workspaceId: workspace.id },
        search: { tab },
      });
      await invokeCmd('cmd_new_child_window', {
        url: location,
        label: 'settings',
        title: 'Yaak Settings',
        innerSize: [600, 550],
      });
    },
  });
}
