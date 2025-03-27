import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import type { ModelPayload } from '@yaakapp-internal/models';
import { modelStoreDataAtom } from '@yaakapp-internal/models';
import { jotaiStore } from '../lib/jotai';
import { activeWorkspaceIdAtom } from './useActiveWorkspace';
import { useListenToTauriEvent } from './useListenToTauriEvent';
import { useRequestUpdateKey } from './useRequestUpdateKey';

export function useSyncModelStores() {
  const { wasUpdatedExternally } = useRequestUpdateKey(null);

  useListenToTauriEvent<ModelPayload>('upserted_model', ({ payload }) => {
    // TODO: Move this logic to useRequestEditor() hook
    if (
      (payload.model.model === 'http_request' ||
        payload.model.model === 'grpc_request' ||
        payload.model.model === 'websocket_request') &&
      ((payload.updateSource.type === 'window' &&
        payload.updateSource.label !== getCurrentWebviewWindow().label) ||
        payload.updateSource.type !== 'window')
    ) {
      wasUpdatedExternally(payload.model.id);
    }

    if (shouldIgnoreModel(payload)) return;

    jotaiStore.set(modelStoreDataAtom, (prev) => {
      const data = structuredClone(prev);
      data[payload.model.model][payload.model.id] = payload.model;
      return data;
    });
  });

  useListenToTauriEvent<ModelPayload>('deleted_model', ({ payload }) => {
    if (shouldIgnoreModel(payload)) return;

    console.log('Delete model', payload);

    jotaiStore.set(modelStoreDataAtom, (prev) => {
      const data = structuredClone(prev);
      delete data[payload.model.model][payload.model.id];
      return data;
    });
  });
}

function shouldIgnoreModel({ model, updateSource }: ModelPayload) {
  // Never ignore updates from non-user sources
  if (updateSource.type !== 'window') {
    return false;
  }

  // Never ignore same-window updates
  if (updateSource.label === getCurrentWebviewWindow().label) {
    return false;
  }

  const activeWorkspaceId = jotaiStore.get(activeWorkspaceIdAtom);
  // Only sync models that belong to this workspace, if a workspace ID is present
  if ('workspaceId' in model && model.workspaceId !== activeWorkspaceId) {
    return;
  }

  if (model.model === 'key_value') {
    return model.namespace === 'no_sync';
  }

  return false;
}
