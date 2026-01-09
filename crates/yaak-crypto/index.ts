import { invoke } from '@tauri-apps/api/core';

export function enableEncryption(workspaceId: string) {
  return invoke<void>('cmd_enable_encryption', { workspaceId });
}

export function revealWorkspaceKey(workspaceId: string) {
  return invoke<string>('cmd_reveal_workspace_key', { workspaceId });
}

export function setWorkspaceKey(args: { workspaceId: string; key: string }) {
  return invoke<void>('cmd_set_workspace_key', args);
}
