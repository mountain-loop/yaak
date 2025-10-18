import { useSearch } from '@tanstack/react-router';
import { atom } from 'jotai';
import { useEffect } from 'react';
import { jotaiStore } from '../lib/jotai';

export const activeFolderIdAtom = atom<string | null>(null);

export function useSubscribeActiveFolderId() {
  const { folder_id } = useSearch({ strict: false });
  useEffect(() => jotaiStore.set(activeFolderIdAtom, folder_id ?? null), [folder_id]);
}
