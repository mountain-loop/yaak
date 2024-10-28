import type { Workspace } from '@yaakapp-internal/models';
import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useWorkspaces } from './useWorkspaces';

export function useActiveWorkspace(): Workspace | null {
  const workspaceId = useActiveWorkspaceId();
  const workspaces = useWorkspaces();

  return useMemo(
    () => workspaces.find((w) => w.id === workspaceId) ?? null,
    [workspaces, workspaceId],
  );
}

function useActiveWorkspaceId(): string | null {
  const { workspaceId } = useParams();
  return workspaceId ?? null;
}
