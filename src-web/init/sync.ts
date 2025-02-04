import { debounce } from '@yaakapp-internal/lib';
import type { AnyModel, ModelPayload } from '@yaakapp-internal/models';
import { watchWorkspaceFiles } from '@yaakapp-internal/sync';
import { syncWorkspace } from '../commands/commands';
import { listenToTauriEvent } from '../hooks/useListenToTauriEvent';
import { workspaceMetaAtom } from '../hooks/useWorkspaceMeta';
import { jotaiStore } from '../lib/jotai';

export function initSync() {
  let unsub: (() => void) | undefined;
  jotaiStore.sub(workspaceMetaAtom, () => {
    unsub?.(); // Unsub from any previous watcher
    const workspaceMeta = jotaiStore.get(workspaceMetaAtom);
    if (workspaceMeta == null) return;
    unsub = initForWorkspace(workspaceMeta.workspaceId, workspaceMeta.settingSyncDir);
  });
}

function initForWorkspace(workspaceId: string, syncDir: string | null) {
  // Sync on sync dir changes
  if (syncDir == null) {
    return;
  }

  const debouncedSync = debounce(() => {
    if (syncDir == null) return;
    syncWorkspace.mutate({ workspaceId, syncDir });
  }, 1000);

  // Sync on model upsert
  const unsubUpsertedModels = listenToTauriEvent<ModelPayload>('upserted_model', (p) => {
    if (isModelRelevant(workspaceId, p.payload.model)) {
      debouncedSync();
    }
  });

  // Sync on model deletion
  const unsubDeletedModels = listenToTauriEvent<ModelPayload>('deleted_model', (p) => {
    if (isModelRelevant(workspaceId, p.payload.model)) {
      debouncedSync();
    }
  });

  // Sync on file changes in sync directory
  const unsubFileWatch = watchWorkspaceFiles(workspaceId, syncDir, debouncedSync);

  console.log('Initializing directory sync for', workspaceId, syncDir);

  // Perform an initial sync operation
  debouncedSync();

  return function unsub() {
    unsubFileWatch();
    unsubDeletedModels();
    unsubUpsertedModels();
  };
}

function isModelRelevant(workspaceId: string, m: AnyModel) {
  if (
    m.model !== 'workspace' &&
    m.model !== 'folder' &&
    m.model !== 'environment' &&
    m.model !== 'http_request' &&
    m.model !== 'grpc_request' &&
    m.model !== 'websocket_request'
  ) {
    return false;
  } else if (m.model === 'workspace') {
    return m.id === workspaceId;
  } else {
    return m.workspaceId === workspaceId;
  }
}
