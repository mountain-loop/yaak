import type { GrpcRequest, HttpRequest, WebsocketRequest } from '@yaakapp-internal/models';
import { createWorkspaceModel } from '@yaakapp-internal/models';
import { activeRequestAtom } from '../hooks/useActiveRequest';
import { expandFolder } from '../hooks/useSidebarItemCollapsed';
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

  // INFO: Expand the parent folder if the new request is it's child
  if (patch.folderId) {
    await expandFolder(patch.folderId);
  }

  await router.navigate({
    to: '/workspaces/$workspaceId',
    params: { workspaceId: patch.workspaceId },
    search: (prev) => ({ ...prev, request_id: newId }),
  });
}
