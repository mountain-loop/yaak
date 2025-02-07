import { SettingsTab } from '../components/Settings/SettingsTab';
import { getActiveWorkspaceId } from '../hooks/useActiveWorkspace';
import { createFastMutation } from '../hooks/useFastMutation';
import { trackEvent } from '../lib/analytics';
import { router } from '../lib/router';
import { invokeCmd } from '../lib/tauri';

export const openSettings = createFastMutation<void, string, SettingsTab | null>({
  mutationKey: ['open_settings'],
  mutationFn: async function (tab) {
    const workspaceId = getActiveWorkspaceId();
    if (workspaceId == null) return;

    trackEvent('dialog', 'show', { id: 'settings', tab: `${tab}` });
    const location = router.buildLocation({
      to: '/workspaces/$workspaceId/settings',
      params: { workspaceId },
      search: { tab: tab ?? SettingsTab.General },
    });
    await invokeCmd('cmd_new_child_window', {
      url: location.href,
      label: 'settings',
      title: 'Yaak Settings',
      innerSize: [750, 600],
    });
  },
});
