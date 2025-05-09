import { debounce } from '@yaakapp-internal/lib';
import type { AnyModel, ModelPayload } from '@yaakapp-internal/models';
import { watchWorkspaceFiles } from '@yaakapp-internal/sync';
import { syncWorkspace } from '../commands/commands';
import { activeWorkspaceIdAtom, activeWorkspaceMetaAtom } from '../hooks/useActiveWorkspace';
import { listenToTauriEvent } from '../hooks/useListenToTauriEvent';
import { jotaiStore } from '../lib/jotai';

export function initSync() {
  initModelListeners();
  initFileChangeListeners();
  sync().catch(console.error);
}

export async function sync({ force }: { force?: boolean } = {}) {
  const workspaceMeta = jotaiStore.get(activeWorkspaceMetaAtom);
  if (workspaceMeta == null || workspaceMeta.settingSyncDir == null) {
    return;
  }

  await syncWorkspace.mutateAsync({
    workspaceId: workspaceMeta.workspaceId,
    syncDir: workspaceMeta.settingSyncDir,
    force,
  });
}

const debouncedSync = debounce(async () => {
  await sync();
}, 1000);

/**
 * Subscribe to model change events. Since we check the workspace ID on sync, we can
 * simply add long-lived subscribers for the lifetime of the app.
 */
function initModelListeners() {
  listenToTauriEvent<ModelPayload>('upserted_model', (p) => {
    if (isModelRelevant(p.payload.model)) debouncedSync();
  });
  listenToTauriEvent<ModelPayload>('deleted_model', (p) => {
    if (isModelRelevant(p.payload.model)) debouncedSync();
  });
}

/**
 * Subscribe to relevant files for a workspace. Since the workspace can change, this will
 * keep track of the active workspace, as well as changes to the sync directory of the
 * current workspace, and re-subscribe when necessary.
 */
function initFileChangeListeners() {
  let unsub: null | ReturnType<typeof watchWorkspaceFiles> = null;
  jotaiStore.sub(activeWorkspaceMetaAtom, async () => {
    await unsub?.(); // Unsub to previous
    const workspaceMeta = jotaiStore.get(activeWorkspaceMetaAtom);
    if (workspaceMeta == null || workspaceMeta.settingSyncDir == null) return;
    debouncedSync(); // Perform an initial sync when switching workspace
    unsub = watchWorkspaceFiles(
      workspaceMeta.workspaceId,
      workspaceMeta.settingSyncDir,
      debouncedSync,
    );
  });
}

function isModelRelevant(m: AnyModel) {
  const workspaceId = jotaiStore.get(activeWorkspaceIdAtom);

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
