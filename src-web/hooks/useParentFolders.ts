import type { Folder, GrpcRequest, HttpRequest, WebsocketRequest } from '@yaakapp-internal/models';
import { foldersAtom } from '@yaakapp-internal/models';
import { useAtomValue } from 'jotai';
import { useMemo } from 'react';

export function useParentFolders(m: Folder | HttpRequest | GrpcRequest | WebsocketRequest | null) {
  const folders = useAtomValue(foldersAtom);

  return useMemo(() => getParentFolders(folders, m), [folders, m]);
}

function getParentFolders(
  folders: Folder[],
  currentModel: Folder | HttpRequest | GrpcRequest | WebsocketRequest | null,
): Folder[] {
  if (currentModel == null) return [];

  const folder = currentModel.folderId ? folders.find((f) => f.id === currentModel.folderId) : null;
  if (folder == null) {
    return [];
  }

  return [folder, ...getParentFolders(folders, folder)];
}
