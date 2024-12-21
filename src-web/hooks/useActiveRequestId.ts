import { useParams } from '@tanstack/react-router';
import { atom, useAtomValue } from 'jotai';
import { useEffect } from 'react';
import {jotaiStore} from "../lib/jotai";

export const activeRequestIdAtom = atom<string>();

export function useActiveRequestId(): string | null {
  return useAtomValue(activeRequestIdAtom) ?? null;
}

export function useSubscribeActiveRequestId() {
  const { requestId } = useParams({ strict: false });
  useEffect(() => {
    jotaiStore.set(activeRequestIdAtom, requestId);
  }, [requestId]);
}
