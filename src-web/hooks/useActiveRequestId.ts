import { useSearch } from '@tanstack/react-router';
import { atom, useAtomValue } from 'jotai';
import { useEffect } from 'react';
import { jotaiStore } from '../lib/jotai';

export const activeRequestIdAtom = atom<string | null>(null);

export function useActiveRequestId(): string | null {
  return useAtomValue(activeRequestIdAtom);
}

export function useSubscribeActiveRequestId() {
  const { request_id } = useSearch({ strict: false });
  useEffect(() => jotaiStore.set(activeRequestIdAtom, request_id ?? null), [request_id]);
}
