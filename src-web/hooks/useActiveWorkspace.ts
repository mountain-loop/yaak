import { useParams } from '@tanstack/react-router';
import { workspaceMetasAtom, workspacesAtom } from '@yaakapp-internal/models';
import { atom } from 'jotai/index';
import { useEffect } from 'react';
import { jotaiStore } from '../lib/jotai';

export const activeWorkspaceIdAtom = atom<string | null>(null);

export const activeWorkspaceAtom = atom((get) => {
  const activeWorkspaceId = get(activeWorkspaceIdAtom);
  const workspaces = get(workspacesAtom);
  return workspaces.find((w) => w.id === activeWorkspaceId) ?? null;
});

export const activeWorkspaceMetaAtom = atom((get) => {
  const activeWorkspaceId = get(activeWorkspaceIdAtom);
  const workspaceMetas = get(workspaceMetasAtom);
  return workspaceMetas.find((m) => m.workspaceId === activeWorkspaceId) ?? null;
});

export function useSubscribeActiveWorkspaceId() {
  const { workspaceId } = useParams({ strict: false });
  useEffect(() => jotaiStore.set(activeWorkspaceIdAtom, workspaceId ?? null), [workspaceId]);
}
