import type { Folder, GrpcRequest, HttpRequest, WebsocketRequest } from '@yaakapp-internal/models';
import { duplicateModel } from '@yaakapp-internal/models';
import { activeWorkspaceIdAtom } from '../hooks/useActiveWorkspace';
import { jotaiStore } from './jotai';
import { router } from './router';

export async function duplicateRequestOrFolderAndNavigate(
  model: Folder | HttpRequest | GrpcRequest | WebsocketRequest | null,
) {
  if (model == null) {
    throw new Error('Cannot duplicate null item');
  }

  const newId = await duplicateModel(model);
  const workspaceId = jotaiStore.get(activeWorkspaceIdAtom);
  if (workspaceId == null) return;

  await router.navigate({
    to: '/workspaces/$workspaceId',
    params: { workspaceId },
    search: (prev) => {
      return model.model === 'folder'
        ? { ...prev, folder_id: null, request_id: newId }
        : { ...prev, folder_id: newId, request_id: null };
    },
  });
}
