import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { patchModel, settingsAtom } from "@yaakapp-internal/models";
import { Heading, VStack } from "@yaakapp-internal/ui";
import { useAtomValue } from "jotai";
import { activeWorkspaceAtom } from "../../hooks/useActiveWorkspace";
import { useCheckForUpdates } from "../../hooks/useCheckForUpdates";
import { appInfo } from "../../lib/appInfo";
import {
  SETTING_FOLLOW_REDIRECTS,
  SETTING_REQUEST_TIMEOUT,
  SETTING_SEND_COOKIES,
  SETTING_STORE_COOKIES,
  SETTING_VALIDATE_CERTIFICATES,
} from "../../lib/requestSettings";
import { revealInFinderText } from "../../lib/reveal";
import { CargoFeature } from "../CargoFeature";
import { IconButton } from "../core/IconButton";
import {
  ModelSettingRowBoolean,
  ModelSettingRowNumber,
  ModelSettingSelectControl,
  SettingValue,
  SettingRow,
  SettingRowBoolean,
  SettingRowSelect,
  SettingsList,
  SettingsSection,
} from "../core/SettingRow";

export function SettingsGeneral() {
  const workspace = useAtomValue(activeWorkspaceAtom);
  const settings = useAtomValue(settingsAtom);
  const checkForUpdates = useCheckForUpdates();

  if (settings == null || workspace == null) {
    return null;
  }

  return (
    <VStack space={1.5} className="mb-4">
      <div className="mb-4">
        <Heading>General</Heading>
        <p className="text-text-subtle">Configure general settings for update behavior and more.</p>
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
                  selectClassName="!w-full"
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
              onChange={(v) => patchModel(settings, { autoupdate: v === "auto" })}
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

        <SettingsSection
          title={
            <>
              Workspace{" "}
              <span className="inline-block bg-surface-highlight px-2 py-0.5 rounded text">
                {workspace.name}
              </span>
            </>
          }
        >
          <ModelSettingRowNumber
            model={workspace}
            modelKey={SETTING_REQUEST_TIMEOUT.modelKey}
            title={SETTING_REQUEST_TIMEOUT.title}
            description={SETTING_REQUEST_TIMEOUT.description}
            placeholder={`${SETTING_REQUEST_TIMEOUT.defaultValue}`}
            required
            validate={(value) => Number.parseInt(value, 10) >= 0}
          />

          <ModelSettingRowBoolean
            model={workspace}
            modelKey={SETTING_VALIDATE_CERTIFICATES.modelKey}
            title={SETTING_VALIDATE_CERTIFICATES.title}
            description={SETTING_VALIDATE_CERTIFICATES.description}
          />

          <ModelSettingRowBoolean
            model={workspace}
            modelKey={SETTING_FOLLOW_REDIRECTS.modelKey}
            title={SETTING_FOLLOW_REDIRECTS.title}
            description={SETTING_FOLLOW_REDIRECTS.description}
          />

          <ModelSettingRowBoolean
            model={workspace}
            modelKey={SETTING_SEND_COOKIES.modelKey}
            title={SETTING_SEND_COOKIES.title}
            description={SETTING_SEND_COOKIES.description}
          />

          <ModelSettingRowBoolean
            model={workspace}
            modelKey={SETTING_STORE_COOKIES.modelKey}
            title={SETTING_STORE_COOKIES.title}
            description={SETTING_STORE_COOKIES.description}
          />
        </SettingsSection>

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
