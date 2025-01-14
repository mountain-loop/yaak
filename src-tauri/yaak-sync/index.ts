import { Channel, invoke } from '@tauri-apps/api/core';
import { emit } from '@tauri-apps/api/event';
import { SyncOp } from './bindings/sync';
import { WatchEvent, WatchResult } from './bindings/watch';

export async function calculateSync(workspaceId: string, syncDir: string) {
  return invoke<SyncOp[]>('plugin:yaak-sync|calculate', {
    workspaceId,
    syncDir,
  });
}

export async function calculateSyncFsOnly(dir: string) {
  return invoke<SyncOp[]>('plugin:yaak-sync|calculate_fs', { dir });
}

export async function applySync(workspaceId: string, syncDir: string, syncOps: SyncOp[]) {
  return invoke<void>('plugin:yaak-sync|apply', {
    workspaceId,
    syncDir,
    syncOps: syncOps,
  });
}

export function watchWorkspaceFiles(
  workspaceId: string,
  syncDir: string,
  callback: (e: WatchEvent) => void,
) {
  const channel = new Channel<WatchEvent>();
  channel.onmessage = callback;
  const promise = invoke<WatchResult>('plugin:yaak-sync|watch', {
    workspaceId,
    syncDir,
    channel,
  });

  return () => {
    promise
      .then(({ unlistenEvent }) => {
        console.log('Cancelling workspace watch', workspaceId, unlistenEvent);
        return emit(unlistenEvent);
      })
      .catch(console.error);
  };
}
