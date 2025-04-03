import type { GrpcRequest, HttpRequest, WebsocketRequest } from '@yaakapp-internal/models';
import { duplicateModel } from '@yaakapp-internal/models';
import { activeWorkspaceIdAtom } from '../hooks/useActiveWorkspace';
import { jotaiStore } from './jotai';
import { router } from './router';

export async function duplicateRequestAndNavigate(
  model: HttpRequest | GrpcRequest | WebsocketRequest | null,
) {
  if (model == null) {
    throw new Error('Cannot duplicate null request');
  }

  const newId = await duplicateModel(model);
  const workspaceId = jotaiStore.get(activeWorkspaceIdAtom);
  if (workspaceId == null) return;

  await router.navigate({
    to: '/workspaces/$workspaceId',
    params: { workspaceId },
    search: (prev) => ({ ...prev, request_id: newId }),
  });
}
