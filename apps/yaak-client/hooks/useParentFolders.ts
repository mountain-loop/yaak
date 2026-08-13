import type { Folder, GrpcRequest, HttpRequest, WebsocketRequest } from "@yaakapp-internal/models";
import { foldersAtom } from "@yaakapp-internal/models";
import { useAtomValue } from "jotai";
import { useMemo } from "react";

export function useParentFolders(m: Folder | HttpRequest | GrpcRequest | WebsocketRequest | null) {
  const folders = useAtomValue(foldersAtom);

  // Key on folderId, not the model itself, so edits to the model (eg. every URL
  // keystroke replacing the active request) don't produce a new array identity
  const folderId = m?.folderId ?? null;
  return useMemo(() => getParentFolders(folders, folderId), [folders, folderId]);
}

function getParentFolders(folders: Folder[], folderId: string | null): Folder[] {
  if (folderId == null) return [];

  const parentFolder = folders.find((f) => f.id === folderId);
  if (parentFolder == null) {
    return [];
  }

  return [parentFolder, ...getParentFolders(folders, parentFolder.folderId ?? null)];
}
