import type { CookieJar } from '@yaakapp-internal/models';
import { invokeCmd } from '../lib/tauri';
import { getCookieJar } from './useCookieJars';
import { useFastMutation } from './useFastMutation';

export function useUpdateCookieJar(id: string | null) {
  return useFastMutation<CookieJar, unknown, Partial<CookieJar> | ((j: CookieJar) => CookieJar)>({
    mutationKey: ['update_cookie_jar', id],
    mutationFn: async (v) => {
      const cookieJar = getCookieJar(id);
      if (cookieJar == null) {
        throw new Error("Can't update a null workspace");
      }

      const newCookieJar = typeof v === 'function' ? v(cookieJar) : { ...cookieJar, ...v };
      return invokeCmd<CookieJar>('cmd_update_cookie_jar', { cookieJar: newCookieJar });
    },
  });
}
