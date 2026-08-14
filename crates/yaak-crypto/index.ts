import { platform } from "@yaakapp-internal/platform";

export function enableEncryption(workspaceId: string) {
  return platform.rpc<void>("cmd_enable_encryption", { workspaceId });
}

export function revealWorkspaceKey(workspaceId: string) {
  return platform.rpc<string>("cmd_reveal_workspace_key", { workspaceId });
}

export function setWorkspaceKey(args: { workspaceId: string; key: string }) {
  return platform.rpc<void>("cmd_set_workspace_key", args);
}

export function disableEncryption(workspaceId: string) {
  return platform.rpc<void>("cmd_disable_encryption", { workspaceId });
}
