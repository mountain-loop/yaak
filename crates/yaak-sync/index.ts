import { platform } from "@yaakapp-internal/platform";
import type { WatchResult } from "@yaakapp-internal/rpc-schema";
import { SyncOp } from "./bindings/gen_sync";
import { WatchEvent } from "./bindings/gen_watch";

export * from "./bindings/gen_models";

export async function calculateSync(workspaceId: string, syncDir: string) {
  return platform.rpc<SyncOp[]>("cmd_sync_calculate", {
    workspaceId,
    syncDir,
  });
}

export async function calculateSyncFsOnly(dir: string) {
  return platform.rpc<SyncOp[]>("cmd_sync_calculate_fs", { dir });
}

export async function applySync(workspaceId: string, syncDir: string, syncOps: SyncOp[]) {
  return platform.rpc<void>("cmd_sync_apply", {
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
  console.log("Watching workspace files", workspaceId, syncDir);
  const handle = platform.rpcStream<WatchResult, WatchEvent>(
    "cmd_sync_watch",
    { workspaceId, syncDir },
    callback,
  );

  void handle.then(({ result }) => {
    addWatchKey(result.unlistenEvent);
  });

  return () =>
    handle
      .then(async ({ result, unlisten }) => {
        console.log("Unwatching workspace files", workspaceId, syncDir);
        unlistenToWatcher(result.unlistenEvent);
        unlisten();
      })
      .catch(console.error);
}

function unlistenToWatcher(unlistenEvent: string) {
  void platform.emit(unlistenEvent).then(() => {
    removeWatchKey(unlistenEvent);
  });
}

function getWatchKeys() {
  return sessionStorage.getItem("workspace-file-watchers")?.split(",").filter(Boolean) ?? [];
}

function setWatchKeys(keys: string[]) {
  sessionStorage.setItem("workspace-file-watchers", keys.join(","));
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
if (keys.length > 0) {
  console.log("Unsubscribing to zombie file watchers", keys);
  keys.forEach(unlistenToWatcher);
}
