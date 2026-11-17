import { settingsAtom } from "@yaakapp-internal/models";
import { SettingsGeneral as SharedSettingsGeneral } from "@yaakapp-internal/ui";
import { useAtomValue } from "jotai";
import { useSettingsView } from "../../hooks/useSettingsView";
import { CommercialUseBanner } from "../CommercialUseBanner";
import { DismissibleBanner } from "../core/DismissibleBanner";

const WORKSPACE_SETTINGS_MOVED_AT = "2026-06-30";

export function SettingsGeneral() {
  const settings = useAtomValue(settingsAtom);
  const bound = useSettingsView();

  if (settings == null || bound == null) {
    return null;
  }

  const showWorkspaceSettingsMovedBanner =
    settings.createdAt.slice(0, 10) < WORKSPACE_SETTINGS_MOVED_AT;

  return (
    <SharedSettingsGeneral
      view={bound.view}
      callbacks={bound.callbacks}
      banner={<CommercialUseBanner source="settings-general" title="Using Yaak for work?" />}
      extraSections={
        showWorkspaceSettingsMovedBanner && (
          <DismissibleBanner
            id="workspace-settings-moved-2026-06-30"
            color="info"
            className="w-full p-4 max-w-xl mr-auto"
          >
            <p>
              Workspace specific settings have moved to <b>Workspace Settings</b>, accessible from
              the workspace switcher menu.
            </p>
          </DismissibleBanner>
        )
      }
    />
  );
}
