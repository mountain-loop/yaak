import { SettingsTheme as SharedSettingsTheme } from "@yaakapp-internal/ui";
import { useAtomValue } from "jotai";
import { activeWorkspaceAtom } from "../../hooks/useActiveWorkspace";
import { useSettingsView } from "../../hooks/useSettingsView";

export function SettingsTheme() {
  const workspace = useAtomValue(activeWorkspaceAtom);
  const bound = useSettingsView();

  if (workspace == null || bound == null) {
    return null;
  }

  return <SharedSettingsTheme view={bound.view} callbacks={bound.callbacks} />;
}
