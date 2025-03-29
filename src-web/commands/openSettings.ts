import { SettingsTab } from '../components/Settings/SettingsTab';
import { activeWorkspaceIdAtom } from '../hooks/useActiveWorkspace';
import { createFastMutation } from '../hooks/useFastMutation';
import { jotaiStore } from '../lib/jotai';
import { router } from '../lib/router';
import { invokeCmd } from '../lib/tauri';

export const openSettings = createFastMutation<void, string, SettingsTab | null>({
  mutationKey: ['open_settings'],
  mutationFn: async function (tab) {
    const workspaceId = jotaiStore.get(activeWorkspaceIdAtom);
    if (workspaceId == null) return;

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
