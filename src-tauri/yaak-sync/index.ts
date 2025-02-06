import { Channel, invoke } from '@tauri-apps/api/core';
import { emit } from '@tauri-apps/api/event';
import { SyncOp } from './bindings/gen_sync';
import { WatchEvent, WatchResult } from './bindings/gen_watch';

export * from './bindings/gen_models';

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
  console.log('Watching workspace files', workspaceId, syncDir);
  const channel = new Channel<WatchEvent>();
  channel.onmessage = callback;
  const unlistenPromise = invoke<WatchResult>('plugin:yaak-sync|watch', {
    workspaceId,
    syncDir,
    channel,
  });

  unlistenPromise.then(({ unlistenEvent }) => {
    addWatchKey(unlistenEvent);
  });

  return () =>
    unlistenPromise
      .then(async ({ unlistenEvent }) => {
        console.log('Unwatching workspace files', workspaceId, syncDir);
        unlistenToWatcher(unlistenEvent);
      })
      .catch(console.error);
}

function unlistenToWatcher(unlistenEvent: string) {
  emit(unlistenEvent).then(() => {
    removeWatchKey(unlistenEvent);
  });
}

function getWatchKeys() {
  return sessionStorage.getItem('workspace-file-watchers')?.split(',').filter(Boolean) ?? [];
}

function setWatchKeys(keys: string[]) {
  sessionStorage.setItem('workspace-file-watchers', keys.join(','));
}

function addWatchKey(key: string) {
  const keys = getWatchKeys();
  setWatchKeys([...keys, key]);
}

function removeWatchKey(key: string) {
  const keys = getWatchKeys();
  setWatchKeys(keys.filter((k) => k !== key));
}

// On page load, unlisten to all zombie watchers
const keys = getWatchKeys();
console.log('Unsubscribing to zombie file watchers', keys);
keys.forEach(unlistenToWatcher);
