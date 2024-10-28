import { useMutation } from '@tanstack/react-query';
import type { CookieJar } from '@yaakapp-internal/models';
import { useSetAtom } from 'jotai/index';
import { getCookieJar } from '../lib/store';
import { invokeCmd } from '../lib/tauri';
import { cookieJarsAtom } from './useCookieJars';
import { updateModelList } from './useSyncModelStores';

export function useUpdateCookieJar(id: string | null) {
  const setCookieJars = useSetAtom(cookieJarsAtom);
  return useMutation<CookieJar, unknown, Partial<CookieJar> | ((j: CookieJar) => CookieJar)>({
    mutationKey: ['update_cookie_jar', id],
    mutationFn: async (v) => {
      const cookieJar = await getCookieJar(id);
      if (cookieJar == null) {
        throw new Error("Can't update a null workspace");
      }

      const newCookieJar = typeof v === 'function' ? v(cookieJar) : { ...cookieJar, ...v };
      return invokeCmd<CookieJar>('cmd_update_cookie_jar', { cookieJar: newCookieJar });
    },
    onSuccess: (cookieJar) => {
      setCookieJars(updateModelList(cookieJar));
    },
  });
}
