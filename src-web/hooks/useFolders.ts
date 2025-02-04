import type { Folder } from '@yaakapp-internal/models';
import { useAtomValue } from 'jotai';
import { atom } from 'jotai/index';
import { jotaiStore } from '../lib/jotai';

export const foldersAtom = atom<Folder[]>([]);

export function useFolders() {
  return useAtomValue(foldersAtom);
}

export function getFolder(id: string | null) {
  return jotaiStore.get(foldersAtom).find((v) => v.id === id) ?? null;
}
