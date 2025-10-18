import type { Folder, GrpcRequest, HttpRequest, WebsocketRequest } from '@yaakapp-internal/models';
import { duplicateModel } from '@yaakapp-internal/models';
import { activeWorkspaceIdAtom } from '../hooks/useActiveWorkspace';
import { jotaiStore } from './jotai';
import { navigateToRequestOrFolderOrWorkspace } from './setWorkspaceSearchParams';

export async function duplicateRequestOrFolderAndNavigate(
  model: Folder | HttpRequest | GrpcRequest | WebsocketRequest | null,
) {
  if (model == null) {
    throw new Error('Cannot duplicate null item');
  }

  const newId = await duplicateModel(model);
  const workspaceId = jotaiStore.get(activeWorkspaceIdAtom);
  if (workspaceId == null) return;

  navigateToRequestOrFolderOrWorkspace(newId, model.model);
}
