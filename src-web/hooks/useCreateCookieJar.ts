import type { CookieJar } from '@yaakapp-internal/models';
import { trackEvent } from '../lib/analytics';
import { showPrompt } from '../lib/prompt';
import { invokeCmd } from '../lib/tauri';
import { getActiveWorkspaceId } from './useActiveWorkspace';
import { useFastMutation } from './useFastMutation';

export function useCreateCookieJar() {
  return useFastMutation<CookieJar | null>({
    mutationKey: ['create_cookie_jar'],
    mutationFn: async () => {
      const workspaceId = getActiveWorkspaceId();
      if (workspaceId == null) {
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

      return invokeCmd('cmd_create_cookie_jar', { workspaceId, name });
    },
    onSettled: () => trackEvent('cookie_jar', 'create'),
  });
}
