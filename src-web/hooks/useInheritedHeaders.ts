import type {
  Folder,
  GrpcRequest,
  HttpRequest,
  HttpRequestHeader,
  WebsocketRequest,
  Workspace,
} from '@yaakapp-internal/models';
import { foldersAtom, workspacesAtom } from '@yaakapp-internal/models';
import { atom, useAtomValue } from 'jotai';

const ancestorsAtom = atom(function (get) {
  return [...get(foldersAtom), ...get(workspacesAtom)];
});

export type HeaderModel = HttpRequest | GrpcRequest | WebsocketRequest | Folder | Workspace;

export function useInheritedHeaders(baseModel: HeaderModel | null) {
  const parents = useAtomValue(ancestorsAtom);

  if (baseModel == null) return [];
  if (baseModel.model === 'workspace') return [];

  const next = (child: HeaderModel): HttpRequestHeader[] => {
    // Short-circuit
    if (child.model === 'workspace') {
      return [];
    }

    // Recurse up the tree
    const parent = parents.find((p) => {
      if (child.folderId) return p.id === child.folderId;
      else return p.id === child.workspaceId;
    });

    // Failed to find parent (should never happen)
    if (parent == null) {
      return [];
    }

    const headers = next(parent);
    return [...headers, ...parent.headers];
  };

  return next(baseModel);
}
