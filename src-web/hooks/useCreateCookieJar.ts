import { createWorkspaceModel } from '@yaakapp-internal/models';
import { jotaiStore } from '../lib/jotai';
import { showPrompt } from '../lib/prompt';
import { activeWorkspaceIdAtom } from './useActiveWorkspace';
import { useFastMutation } from './useFastMutation';

export function useCreateCookieJar() {
  return useFastMutation({
    mutationKey: ['create_cookie_jar'],
    mutationFn: async () => {
      const workspaceId = jotaiStore.get(activeWorkspaceIdAtom);
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

      await createWorkspaceModel({ model: 'cookie_jar', workspaceId, name });
    },
  });
}
