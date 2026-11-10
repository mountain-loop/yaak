import type { ReactNode } from "react";
import { IconButton } from "../IconButton";
import {
  SettingRow,
  SettingRowBoolean,
  SettingRowSelect,
  SettingSelectControl,
  SettingsList,
  SettingsSection,
  SettingValue,
} from "./SettingRow";
import { SettingsPage } from "./SettingsPage";
import type { SettingsCallbacks, SettingsView } from "./types";

export interface SettingsGeneralProps {
  view: SettingsView;
  callbacks: SettingsCallbacks;
  /** Shown under the heading, like the client's commercial-use banner */
  banner?: ReactNode;
  /** Sections only this app has, shown before App Info */
  extraSections?: ReactNode;
}

export function SettingsGeneral({ view, callbacks, banner, extraSections }: SettingsGeneralProps) {
  const { app, values } = view;
  return (
    <SettingsPage
      title="General"
      description="Configure general settings for update behavior and more."
      banner={banner}
    >
      <SettingsList className="space-y-8">
        {view.updates != null && <SettingsUpdatesSection view={view} callbacks={callbacks} />}

        {view.feedbackPrompts && (
          <SettingsSection title="Feedback">
            <SettingRowBoolean
              title="Prompt for feedback"
              description="Show rare one-time prompts asking how new features are working."
              checked={values.promptFeedback}
              onChange={(promptFeedback) => callbacks.onChange({ promptFeedback })}
            />
          </SettingsSection>
        )}

        {extraSections}

        <SettingsSection title="App Info">
          <SettingRow title="Version" description={`Current ${app.name} version.`}>
            <SettingValue value={app.version} />
          </SettingRow>
          <SettingRow
            title="Data Directory"
            description={`Where ${app.name} stores application data.`}
            controlClassName="min-w-0 max-w-[min(42rem,55vw)] gap-2"
          >
            <SettingValue
              value={app.dataDir}
              actions={[
                {
                  title: app.revealPathLabel,
                  icon: "folder_open",
                  onClick: () => callbacks.onRevealPath(app.dataDir),
                },
              ]}
            />
          </SettingRow>
          <SettingRow
            title="Logs Directory"
            description={`Where ${app.name} writes application logs.`}
            controlClassName="min-w-0 max-w-[min(42rem,55vw)] gap-2"
          >
            <SettingValue
              value={app.logDir}
              actions={[
                {
                  title: app.revealPathLabel,
                  icon: "folder_open",
                  onClick: () => callbacks.onRevealPath(app.logDir),
                },
              ]}
            />
          </SettingRow>
        </SettingsSection>
      </SettingsList>
    </SettingsPage>
  );
}

/** The update channel, how updates install, and the check button */
export function SettingsUpdatesSection({
  view,
  callbacks,
}: {
  view: Pick<SettingsView, "app" | "values" | "updates">;
  callbacks: Pick<SettingsCallbacks, "onChange" | "onCheckForUpdates">;
}) {
  const { app, values } = view;
  return (
    <SettingsSection title="Updates">
      <SettingRow
        title="Update Channel"
        description={`Choose whether ${app.name} should use stable releases or beta releases.`}
      >
        <div className="grid grid-cols-[12rem_auto] gap-1">
          <SettingSelectControl
            name="updateChannel"
            label="Update Channel"
            selectClassName="w-full!"
            value={values.updateChannel}
            onChange={(updateChannel) => callbacks.onChange({ updateChannel })}
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
            spin={view.updates?.checking ?? false}
            onClick={() => callbacks.onCheckForUpdates()}
          />
        </div>
      </SettingRow>

      <SettingRowSelect
        title="Update Behavior"
        description="Choose whether updates are installed automatically or manually."
        name="autoupdate"
        value={values.autoupdate ? "auto" : "manual"}
        onChange={(v) => callbacks.onChange({ autoupdate: v === "auto" })}
        options={[
          { label: "Automatic", value: "auto" },
          { label: "Manual", value: "manual" },
        ]}
      />

      <SettingRowBoolean
        title="Automatically download updates"
        description={`Download ${app.name} updates in the background so they are ready to install.`}
        disabled={!values.autoupdate}
        checked={values.autoDownloadUpdates}
        onChange={(autoDownloadUpdates) => callbacks.onChange({ autoDownloadUpdates })}
      />

      <SettingRowBoolean
        title="Check for notifications"
        description="Periodically ping Yaak servers to check for relevant notifications."
        checked={values.checkNotifications}
        onChange={(checkNotifications) => callbacks.onChange({ checkNotifications })}
      />

      <SettingRowBoolean
        title="Send anonymous usage statistics"
        description={`${app.name} is local-first and does not collect analytics or usage data.`}
        disabled
        checked={false}
        onChange={() => {}}
      />
    </SettingsSection>
  );
}
