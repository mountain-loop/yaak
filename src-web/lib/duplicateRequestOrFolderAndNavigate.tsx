import type { Folder, GrpcRequest, HttpRequest, WebsocketRequest } from '@yaakapp-internal/models';
import { duplicateModel } from '@yaakapp-internal/models';
import { activeWorkspaceIdAtom } from '../hooks/useActiveWorkspace';
import { jotaiStore } from './jotai';
import { navigateToRequestOrFolderOrWorkspace } from './setWorkspaceSearchParams';

export async function duplicateRequestOrFolderAndNavigate(
  model: Folder | HttpRequest | GrpcRequest | WebsocketRequest | null,
  options?: { makePrivate?: boolean },
) {
  if (model == null) {
    throw new Error('Cannot duplicate null item');
  }

  const modelToDuplicate =
    options?.makePrivate && 'public' in model ? { ...model, public: false } : model;
  const newId = await duplicateModel(modelToDuplicate);
  const workspaceId = jotaiStore.get(activeWorkspaceIdAtom);
  if (workspaceId == null || model.model === 'folder') return;

  navigateToRequestOrFolderOrWorkspace(newId, model.model);
}
