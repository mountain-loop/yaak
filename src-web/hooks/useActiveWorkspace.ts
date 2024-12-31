import { useParams } from '@tanstack/react-router';
import type { Workspace } from '@yaakapp-internal/models';
import { atom, useAtomValue } from 'jotai/index';
import { useEffect } from 'react';
import { jotaiStore } from '../lib/jotai';
import { workspacesAtom } from './useWorkspaces';

export const activeWorkspaceIdAtom = atom<string>();

export const activeWorkspaceAtom = atom<Workspace | null>((get) => {
  const activeWorkspaceId = get(activeWorkspaceIdAtom);
  const workspaces = get(workspacesAtom);
  return workspaces.find((w) => w.id === activeWorkspaceId) ?? null;
});

export function useActiveWorkspace(): Workspace | null {
  return useAtomValue(activeWorkspaceAtom);
}

export function getActiveWorkspaceId() {
  return jotaiStore.get(activeWorkspaceIdAtom) ?? null;
}

export function useSubscribeActiveWorkspaceId() {
  const { workspaceId } = useParams({ strict: false });
  useEffect(() => {
    jotaiStore.set(activeWorkspaceIdAtom, workspaceId);
  }, [workspaceId]);
}
