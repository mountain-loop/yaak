import { useSearch } from '@tanstack/react-router';
import type { Environment } from '@yaakapp-internal/models';
import { environmentsAtom } from '@yaakapp-internal/models';
import { useAtomValue } from 'jotai';
import { atom } from 'jotai/index';
import { useEffect } from 'react';
import { jotaiStore } from '../lib/jotai';

export const activeEnvironmentIdAtom = atom<string>();

export const activeEnvironmentAtom = atom<Environment | null>((get) => {
  const activeEnvironmentId = get(activeEnvironmentIdAtom);
  return get(environmentsAtom).find((e) => e.id === activeEnvironmentId) ?? null;
});

export function useActiveEnvironment() {
  return useAtomValue(activeEnvironmentAtom);
}

export function getActiveEnvironment() {
  return jotaiStore.get(activeEnvironmentAtom);
}

export function useSubscribeActiveEnvironmentId() {
  const { environment_id } = useSearch({ strict: false });
  useEffect(
    () => jotaiStore.set(activeEnvironmentIdAtom, environment_id ?? undefined),
    [environment_id],
  );
}
