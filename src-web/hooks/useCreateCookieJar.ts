import { useMutation } from '@tanstack/react-query';
import type { CookieJar } from '@yaakapp-internal/models';
import {useSetAtom} from "jotai";
import { trackEvent } from '../lib/analytics';
import { invokeCmd } from '../lib/tauri';
import { useActiveWorkspace } from './useActiveWorkspace';
import {cookieJarsAtom} from "./useCookieJars";
import { usePrompt } from './usePrompt';
import {updateModelList} from "./useSyncModelStores";

export function useCreateCookieJar() {
  const workspace = useActiveWorkspace();
  const prompt = usePrompt();
  const setCookieJars = useSetAtom(cookieJarsAtom);

  return useMutation<CookieJar | null>({
    mutationKey: ['create_cookie_jar'],
    mutationFn: async () => {
      if (workspace === null) {
        throw new Error("Cannot create cookie jar when there's no active workspace");
      }
      const name = await prompt({
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
    onSuccess: (cookieJar) => {
      if (cookieJar == null) return;

      // Optimistic update
      setCookieJars(updateModelList(cookieJar));
    },
    onSettled: () => trackEvent('cookie_jar', 'create'),
  });
}
