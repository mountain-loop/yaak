import { useParams } from '@tanstack/react-router';
import type { Workspace } from '@yaakapp-internal/models';
import { atom, useAtomValue } from 'jotai/index';
import { useEffect } from 'react';
import { jotaiStore } from '../lib/jotai';
import { useWorkspaces } from './useWorkspaces';

export const activeWorkspaceIdAtom = atom<string>();

export function useActiveWorkspace(): Workspace | null {
  const workspaceId = useActiveWorkspaceId();
  const workspaces = useWorkspaces();
  return workspaces.find((w) => w.id === workspaceId) ?? null;
}

function useActiveWorkspaceId(): string | null {
  return useAtomValue(activeWorkspaceIdAtom) ?? null;
}

export function getActiveWorkspaceId() {
  return jotaiStore.get(activeWorkspaceIdAtom);
}

export function useSubscribeActiveWorkspaceId() {
  const { workspaceId } = useParams({ strict: false });
  useEffect(() => {
    jotaiStore.set(activeWorkspaceIdAtom, workspaceId);
  }, [workspaceId]);
}
