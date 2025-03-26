import type { CookieJar } from '@yaakapp-internal/models';
import { InlineCode } from '../components/core/InlineCode';
import { showConfirmDelete } from '../lib/confirm';
import { invokeCmd } from '../lib/tauri';
import { useFastMutation } from './useFastMutation';

export function useDeleteCookieJar(cookieJar: CookieJar | null) {
  return useFastMutation<CookieJar | null, string>({
    mutationKey: ['delete_cookie_jar', cookieJar?.id],
    mutationFn: async () => {
      const confirmed = await showConfirmDelete({
        id: 'delete-cookie-jar',
        title: 'Delete CookieJar',
        description: (
          <>
            Permanently delete <InlineCode>{cookieJar?.name}</InlineCode>?
          </>
        ),
      });
      if (!confirmed) return null;
      return invokeCmd('cmd_delete_cookie_jar', { cookieJarId: cookieJar?.id });
    },
  });
}
