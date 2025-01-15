import type { Folder } from '@yaakapp-internal/models';
import { useAtomValue } from 'jotai';
import { atom } from 'jotai/index';

export const foldersAtom = atom<Folder[]>([]);

export function useFolders() {
  return useAtomValue(foldersAtom);
}
