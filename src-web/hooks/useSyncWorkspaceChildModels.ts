import { changeModelStoreWorkspace } from '@yaakapp-internal/models';
import { useEffect } from 'react';
import { jotaiStore } from '../lib/jotai';
import { activeWorkspaceIdAtom } from './useActiveWorkspace';

export function useSyncWorkspaceChildModels() {
  useEffect(() => {
    const unsub = jotaiStore.sub(activeWorkspaceIdAtom, sync);
    sync().catch(console.error);
    return unsub;
  }, []);
}

async function sync() {
  const workspaceId = jotaiStore.get(activeWorkspaceIdAtom) ?? null;
  changeModelStoreWorkspace(workspaceId).catch(console.error);
}
