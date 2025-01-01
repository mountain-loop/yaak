import { useRouter } from '@tanstack/react-router';
import { SettingsTab } from '../components/Settings/SettingsTab';
import { trackEvent } from '../lib/analytics';
import { invokeCmd } from '../lib/tauri';
import { getActiveWorkspaceId } from './useActiveWorkspace';
import { useFastMutation } from './useFastMutation';

export function useOpenSettings(tab = SettingsTab.General) {
  const router = useRouter();
  return useFastMutation({
    mutationKey: ['open_settings'],
    mutationFn: async () => {
      const workspaceId = getActiveWorkspaceId();
      if (workspaceId == null) return;

      trackEvent('dialog', 'show', { id: 'settings', tab: `${tab}` });
      const location = router.buildLocation({
        to: '/workspaces/$workspaceId/settings',
        params: { workspaceId },
        search: { tab },
      });
      await invokeCmd('cmd_new_child_window', {
        url: location.href,
        label: 'settings',
        title: 'Yaak Settings',
        innerSize: [600, 550],
      });
    },
  });
}
