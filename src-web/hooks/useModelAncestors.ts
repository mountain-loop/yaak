import type { AnyModel, Folder, Workspace } from '@yaakapp-internal/models';
import { foldersAtom, workspacesAtom } from '@yaakapp-internal/models';
import { useAtomValue } from 'jotai';
import { useMemo } from 'react';

type ModelAncestor = Folder | Workspace;

export function useModelAncestors(m: AnyModel | null) {
  const folders = useAtomValue(foldersAtom);
  const workspaces = useAtomValue(workspacesAtom);

  return useMemo(() => getModelAncestors(folders, workspaces, m), [folders, workspaces, m]);
}

export function getModelAncestors(
  folders: Folder[],
  workspaces: Workspace[],
  currentModel: AnyModel | null,
): ModelAncestor[] {
  if (currentModel == null) return [];

  const parentFolder =
    'folderId' in currentModel && currentModel.folderId
      ? folders.find((f) => f.id === currentModel.folderId)
      : null;

  if (parentFolder != null) {
    return [parentFolder, ...getModelAncestors(folders, workspaces, parentFolder)];
  }

  const parentWorkspace =
    'workspaceId' in currentModel && currentModel.workspaceId
      ? workspaces.find((w) => w.id === currentModel.workspaceId)
      : null;

  if (parentWorkspace != null) {
    return [parentWorkspace, ...getModelAncestors(folders, workspaces, parentWorkspace)];
  }

  return [];
}
