import type { CookieJar } from '@yaakapp-internal/models';
import { jotaiStore } from '../lib/jotai';
import { showPrompt } from '../lib/prompt';
import { invokeCmd } from '../lib/tauri';
import { activeWorkspaceAtom } from './useActiveWorkspace';
import { useFastMutation } from './useFastMutation';

export function useCreateCookieJar() {
  return useFastMutation<CookieJar | null>({
    mutationKey: ['create_cookie_jar'],
    mutationFn: async () => {
      const workspace = jotaiStore.get(activeWorkspaceAtom);
      if (workspace == null) {
        throw new Error("Cannot create cookie jar when there's no active workspace");
      }
      const name = await showPrompt({
        id: 'new-cookie-jar',
        title: 'New CookieJar',
        placeholder: 'My Jar',
        confirmText: 'Create',
        label: 'Name',
        defaultValue: 'My Jar',
      });
      if (name == null) return null;

      return invokeCmd('cmd_create_cookie_jar', { workspaceId: workspace.id, name });
    },
  });
}
