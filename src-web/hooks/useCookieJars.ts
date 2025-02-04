import type { CookieJar } from '@yaakapp-internal/models';
import { atom, useAtomValue } from 'jotai';
import { jotaiStore } from '../lib/jotai';

export const cookieJarsAtom = atom<CookieJar[] | undefined>();

export const sortedCookieJars = atom((get) => {
  return get(cookieJarsAtom)?.sort((a, b) => a.name.localeCompare(b.name));
});

export function useCookieJars() {
  return useAtomValue(sortedCookieJars);
}

export function getCookieJar(id: string | null) {
  return jotaiStore.get(cookieJarsAtom)?.find((e) => e.id === id) ?? null;
}
