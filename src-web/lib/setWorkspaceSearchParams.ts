import type { Folder, GrpcRequest, WebsocketRequest, Workspace } from '@yaakapp-internal/models';
import type { HttpRequest } from '@yaakapp-internal/sync';
import { router } from './router.js';

/**
 * Setting search params using "from" on the global router instance in tanstack router does not
 * currently behave very well, so this is a wrapper function that gives a typesafe interface
 * for the same thing.
 */
export function setWorkspaceSearchParams(
  search: Partial<{
    cookie_jar_id: string | null;
    environment_id: string | null;
    request_id: string | null;
    folder_id: string | null;
  }>,
) {
  // biome-ignore lint/suspicious/noExplicitAny: <explanation>
  (router as any)
    .navigate({
      // biome-ignore lint/suspicious/noExplicitAny: <explanation>
      search: (prev: any) => {
        // console.log('Navigating to', { prev, search });
        const o = { ...prev, ...search };
        for (const k of Object.keys(o)) {
          if (o[k] == null) {
            delete o[k];
          }
        }
        return o;
      },
    })
    .catch(console.error);
}

export function navigateToRequestOrFolderOrWorkspace(
  id: string,
  model: (Workspace | Folder | HttpRequest | GrpcRequest | WebsocketRequest)['model'],
) {
  if (model === 'workspace') {
    setWorkspaceSearchParams({ request_id: null, folder_id: null });
  } else if (model === 'folder') {
    setWorkspaceSearchParams({ request_id: null, folder_id: id });
  } else {
    setWorkspaceSearchParams({ request_id: id, folder_id: null });
  }
}
