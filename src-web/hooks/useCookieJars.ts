import type { CookieJar } from '@yaakapp-internal/models';
import { atom, useAtomValue } from 'jotai';

export const cookieJarsAtom = atom<CookieJar[] | undefined>();

export const sortedCookieJars = atom((get) =>
  get(cookieJarsAtom)?.sort((a, b) => a.name.localeCompare(b.name)),
);

export function useCookieJars() {
  return useAtomValue(sortedCookieJars);
}
