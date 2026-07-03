import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { patchModel, settingsAtom } from "@yaakapp-internal/models";
import { Heading, VStack } from "@yaakapp-internal/ui";
import { useAtomValue } from "jotai";
import { useCheckForUpdates } from "../../hooks/useCheckForUpdates";
import { appInfo } from "../../lib/appInfo";
import { revealInFinderText } from "../../lib/reveal";
import { CargoFeature } from "../CargoFeature";
import { CommercialUseBanner } from "../CommercialUseBanner";
import { DismissibleBanner } from "../core/DismissibleBanner";
import { IconButton } from "../core/IconButton";
import {
  ModelSettingRowBoolean,
  ModelSettingSelectControl,
  SettingValue,
  SettingRow,
  SettingRowBoolean,
  SettingRowSelect,
  SettingsList,
  SettingsSection,
} from "../core/SettingRow";

const WORKSPACE_SETTINGS_MOVED_AT = "2026-06-30";

export function SettingsGeneral() {
  const settings = useAtomValue(settingsAtom);
  const checkForUpdates = useCheckForUpdates();

  if (settings == null) {
    return null;
  }

  const showWorkspaceSettingsMovedBanner =
    settings.createdAt.slice(0, 10) < WORKSPACE_SETTINGS_MOVED_AT;

  return (
    <VStack space={1.5} className="mb-4">
      <div>
        <Heading>General</Heading>
        <p className="text-text-subtle">
          Configure general settings for update behavior and more.
        </p>
      </div>
      <div className="mt-3 mb-5">
        <CommercialUseBanner source="settings-general" title="Using Yaak for work?" />
      </div>
      <SettingsList className="space-y-8">
        <CargoFeature feature="updater">
          <SettingsSection title="Updates">
            <SettingRow
              title="Update Channel"
              description="Choose whether Yaak should use stable releases or beta releases."
            >
              <div className="grid grid-cols-[12rem_auto] gap-1">
                <ModelSettingSelectControl
                  model={settings}
                  modelKey="updateChannel"
                  label="Update Channel"
                  selectClassName="w-full!"
                  options={[
                    { label: "Stable", value: "stable" },
                    { label: "Beta", value: "beta" },
                  ]}
                />
                <IconButton
                  variant="border"
                  size="sm"
                  title="Check for updates"
                  icon="refresh"
                  spin={checkForUpdates.isPending}
                  onClick={() => checkForUpdates.mutateAsync()}
                />
              </div>
            </SettingRow>

            <SettingRowSelect
              title="Update Behavior"
              description="Choose whether updates are installed automatically or manually."
              name="autoupdate"
              value={settings.autoupdate ? "auto" : "manual"}
              onChange={(v) =>
                patchModel(settings, { autoupdate: v === "auto" })
              }
              options={[
                { label: "Automatic", value: "auto" },
                { label: "Manual", value: "manual" },
              ]}
            />

            <ModelSettingRowBoolean
              model={settings}
              modelKey="autoDownloadUpdates"
              title="Automatically download updates"
              description="Download Yaak updates in the background so they are ready to install."
              disabled={!settings.autoupdate}
            />

            <ModelSettingRowBoolean
              model={settings}
              modelKey="checkNotifications"
              title="Check for notifications"
              description="Periodically ping Yaak servers to check for relevant notifications."
            />

            <SettingRowBoolean
              title="Send anonymous usage statistics"
              description="Yaak is local-first and does not collect analytics or usage data."
              disabled
              checked={false}
              onChange={() => {}}
            />
          </SettingsSection>
        </CargoFeature>

        {showWorkspaceSettingsMovedBanner && (
          <DismissibleBanner
            id="workspace-settings-moved-2026-06-30"
            color="info"
            className="w-full p-4 max-w-xl mr-auto"
          >
            <p>
              Workspace specific settings have moved to{" "}
              <b>Workspace Settings</b>, accessible from the workspace switcher
              menu.
            </p>
          </DismissibleBanner>
        )}

        <SettingsSection title="App Info">
          <SettingRow title="Version" description="Current Yaak version.">
            <SettingValue value={appInfo.version} />
          </SettingRow>
          <SettingRow
            title="Data Directory"
            description="Where Yaak stores application data."
            controlClassName="min-w-0 max-w-[min(42rem,55vw)] gap-2"
          >
            <SettingValue
              value={appInfo.appDataDir}
              actions={[
                {
                  title: revealInFinderText,
                  icon: "folder_open",
                  onClick: () => revealItemInDir(appInfo.appDataDir),
                },
              ]}
            />
          </SettingRow>
          <SettingRow
            title="Logs Directory"
            description="Where Yaak writes application logs."
            controlClassName="min-w-0 max-w-[min(42rem,55vw)] gap-2"
          >
            <SettingValue
              value={appInfo.appLogDir}
              actions={[
                {
                  title: revealInFinderText,
                  icon: "folder_open",
                  onClick: () => revealItemInDir(appInfo.appLogDir),
                },
              ]}
            />
          </SettingRow>
        </SettingsSection>
      </SettingsList>
    </VStack>
  );
}
