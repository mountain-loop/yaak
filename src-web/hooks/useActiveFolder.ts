import { foldersAtom } from '@yaakapp-internal/models';
import { atom } from 'jotai';
import { activeFolderIdAtom } from './useActiveFolderId';

export const activeFolderAtom = atom((get) => {
  const activeFolderId = get(activeFolderIdAtom);
  const folders = get(foldersAtom);
  return folders.find((r) => r.id === activeFolderId) ?? null;
});
