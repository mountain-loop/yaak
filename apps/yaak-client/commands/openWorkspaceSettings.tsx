import type { WorkspaceSettingsTab } from "../components/WorkspaceSettingsDialog";
import { WorkspaceSettingsDialog } from "../components/WorkspaceSettingsDialog";
import { activeWorkspaceIdAtom } from "../hooks/useActiveWorkspace";
import { jotaiStore } from "../lib/jotai";

export function openWorkspaceSettings(tab?: WorkspaceSettingsTab) {
  const workspaceId = jotaiStore.get(activeWorkspaceIdAtom);
  if (workspaceId == null) return;
  WorkspaceSettingsDialog.show(workspaceId, tab);
}
