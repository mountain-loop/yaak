import { invoke } from '@tauri-apps/api/core';
import { Workspace } from '@yaakapp-internal/models';
import { SyncOp } from './bindings/sync';

export const calculateSync = async (workspace: Workspace) => {
  if (!workspace.settingSyncDir) throw new Error("Workspace sync dir not configured");

  return invoke<SyncOp[]>('plugin:yaak-sync|calculate', {
    workspaceId: workspace.id,
    dir: workspace.settingSyncDir,
  });
};

export const applySync = async (workspace: Workspace, ops: SyncOp[]) => {
  console.log('Applying sync', ops);
  return invoke<void>('plugin:yaak-sync|apply', {
    workspaceId: workspace.id,
    dir: workspace.settingSyncDir,
  });
};
