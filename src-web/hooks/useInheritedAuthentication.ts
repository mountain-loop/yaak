import type {
  Folder,
  GrpcRequest,
  HttpRequest,
  WebsocketRequest,
  Workspace,
} from '@yaakapp-internal/models';
import { foldersAtom, workspacesAtom } from '@yaakapp-internal/models';
import { atom, useAtomValue } from 'jotai';

const ancestorsAtom = atom(function (get) {
  return [...get(foldersAtom), ...get(workspacesAtom)];
});

export type AuthenticatedModel = HttpRequest | GrpcRequest | WebsocketRequest | Folder | Workspace;

export function useInheritedAuthentication(
  baseModel: AuthenticatedModel | null,
) {
  const parents = useAtomValue(ancestorsAtom);

  if (baseModel == null) return null;

  const next = (child: AuthenticatedModel) => {
    // We hit the top
    if (child.model === 'workspace') {
      return child.authenticationType == null ? null : child;
    }

    // Has valid auth
    if (child.authenticationType !== null) {
      return child;
    }

    // Recurse up the tree
    const parent = parents.find((p) => {
      if (child.folderId) return p.id === child.folderId;
      else return p.id === child.workspaceId;
    });

    // Failed to find parent (should never happen)
    if (parent == null) {
      return null;
    }

    return next(parent);
  };

  return next(baseModel);
}
