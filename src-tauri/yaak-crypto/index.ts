import { invoke } from '@tauri-apps/api/core';

export function enableEncryption(workspaceId: string) {
  return invoke<void>('plugin:yaak-crypto|enable_encryption', { workspaceId });
}

export function revealWorkspaceKey(workspaceId: string) {
  return invoke<string>('plugin:yaak-crypto|reveal_workspace_key', { workspaceId });
}

export function setWorkspaceKey(args: { workspaceId: string; key: string }) {
  return invoke<void>('plugin:yaak-crypto|set_workspace_key', args);
}
