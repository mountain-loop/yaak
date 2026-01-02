import type { SettingsTab } from '../components/Settings/Settings';
import { activeWorkspaceIdAtom } from '../hooks/useActiveWorkspace';
import { createFastMutation } from '../hooks/useFastMutation';
import { jotaiStore } from '../lib/jotai';
import { router } from '../lib/router';
import { invokeCmd } from '../lib/tauri';

// Allow tab with optional subtab (e.g., "plugins:installed")
type SettingsTabWithSubtab = SettingsTab | `${SettingsTab}:${string}` | null;

export const openSettings = createFastMutation<void, string, SettingsTabWithSubtab>({
  mutationKey: ['open_settings'],
  mutationFn: async (tab) => {
    const workspaceId = jotaiStore.get(activeWorkspaceIdAtom);
    if (workspaceId == null) return;

    const location = router.buildLocation({
      to: '/workspaces/$workspaceId/settings',
      params: { workspaceId },
      search: { tab: (tab ?? undefined) as SettingsTab | undefined },
    });

    await invokeCmd('cmd_new_child_window', {
      url: location.href,
      label: 'settings',
      title: 'Yaak Settings',
      innerSize: [750, 600],
    });
  },
});
