import type { GrpcRequest, HttpRequest, WebsocketRequest } from '@yaakapp-internal/models';
import { createWorkspaceModel } from '@yaakapp-internal/models';
import { activeRequestAtom } from '../hooks/useActiveRequest';
import { jotaiStore } from './jotai';
import { router } from './router';

export async function createRequestAndNavigate<
  T extends HttpRequest | GrpcRequest | WebsocketRequest,
>(patch: Partial<T> & Pick<T, 'model' | 'workspaceId'>) {
  const activeRequest = jotaiStore.get(activeRequestAtom);

  if (patch.sortPriority === undefined) {
    if (activeRequest != null) {
      // Place above currently active request
      patch.sortPriority = activeRequest.sortPriority - 0.0001;
    } else {
      // Place at the very top
      patch.sortPriority = -Date.now();
    }
  }
  patch.folderId = patch.folderId || activeRequest?.folderId;

  const newId = await createWorkspaceModel(patch);

  await router.navigate({
    to: '/workspaces/$workspaceId',
    params: { workspaceId: patch.workspaceId },
    search: (prev) => ({ ...prev, request_id: newId }),
  });
}
