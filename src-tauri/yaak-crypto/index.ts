import { invoke } from '@tauri-apps/api/core';

export function enableEncryption(workspaceId: string) {
  return invoke<string>('plugin:yaak-crypto|enable_encryption', { workspaceId });
}
