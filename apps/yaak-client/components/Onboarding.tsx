import type { Color } from "@yaakapp-internal/plugins";
import { platform } from "@yaakapp-internal/platform";
import { settingsAtom } from "@yaakapp-internal/models";
import { HeaderSize, Heading, Icon, type IconProps, LoadingIcon } from "@yaakapp-internal/ui";
import classNames from "classnames";
import { useAtomValue } from "jotai";
import { useState } from "react";
import { openWorkspaceFromSyncDir } from "../commands/openWorkspaceFromSyncDir";
import { showDialog } from "../lib/dialog";
import { importData } from "../lib/importData";
import {
  createExampleWorkspace,
  createFreshWorkspace,
  type OnboardingChoice,
  recordOnboardingChoice,
} from "../lib/onboarding";
import { showErrorToast } from "../lib/toast";
import { CloneGitRepositoryDialog } from "./CloneGitRepositoryDialog";
import { Button } from "./core/Button";

/** Shown instead of a workspace when there are none. */
export function Onboarding() {
  const settings = useAtomValue(settingsAtom);
  const { capabilities } = platform;
  const canImport = capabilities.plugins;
  const showAlreadyUsing = capabilities.localFiles || capabilities.git || canImport;
  const [busy, setBusy] = useState<OnboardingChoice | null>(null);

  const choose = (choice: OnboardingChoice, run: () => Promise<void> | void) => async () => {
    recordOnboardingChoice(choice);
    setBusy(choice);
    try {
      await run();
    } catch (err) {
      showErrorToast({
        id: "onboarding-failed",
        title: "Something went wrong",
        message: String(err),
      });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="grid grid-rows-[auto_minmax(0,1fr)] h-full w-full">
      <HeaderSize
        data-tauri-drag-region
        size="lg"
        className="x-theme-appHeader bg-surface"
        osType={platform.osType()}
        hideWindowControls={settings.hideWindowControls}
        useNativeTitlebar={settings.useNativeTitlebar}
        interfaceScale={settings.interfaceScale}
      />
      <div className="overflow-auto px-6 py-10 grid">
        <div className="m-auto w-full max-w-lg flex flex-col gap-7">
          <div className="flex flex-col gap-1.5">
            <Heading>How would you like to get started?</Heading>
            <p className="text-text-subtle">
              {canImport
                ? "Bring over existing work, try a real API, or start fresh."
                : "Try a real API, or start fresh."}
            </p>
          </div>

          <div className="flex flex-col gap-2">
            {canImport && (
              <StartOption
                color="primary"
                icon="folder_input"
                title="Migrate from another tool"
                description="Postman, Insomnia, Bruno, OpenAPI, or curl"
                busy={busy === "import"}
                disabled={busy != null}
                onClick={choose("import", () => importData.mutateAsync())}
              />
            )}
            <StartOption
              color="info"
              icon="flask"
              title="Try Yaak with a real API"
              description="Ready-made requests you can send right away"
              busy={busy === "example"}
              disabled={busy != null}
              onClick={choose("example", createExampleWorkspace)}
            />
            <StartOption
              color="success"
              icon="plus"
              title="Start fresh"
              description="An empty workspace for your first request"
              busy={busy === "fresh"}
              disabled={busy != null}
              onClick={choose("fresh", createFreshWorkspace)}
            />
          </div>

          {showAlreadyUsing && (
            <div className="pt-5 border-t border-dashed border-border-subtle flex flex-col items-start gap-2.5">
              <span className="text-sm text-text-subtle">Already using Yaak?</span>
              <div className="flex flex-wrap gap-2">
                {capabilities.localFiles && (
                  <Button
                    size="xs"
                    variant="border"
                    color="secondary"
                    leftSlot={<Icon icon="folder_open" size="sm" />}
                    disabled={busy != null}
                    onClick={choose("open_folder", async () => {
                      const dir = await platform.dialog.open({
                        title: "Select Workspace Directory",
                        directory: true,
                        multiple: false,
                      });
                      if (dir == null) return;
                      await openWorkspaceFromSyncDir.mutateAsync(dir);
                    })}
                  >
                    Open folder
                  </Button>
                )}
                {capabilities.git && (
                  <Button
                    size="xs"
                    variant="border"
                    color="secondary"
                    leftSlot={<Icon icon="git_branch" size="sm" />}
                    disabled={busy != null}
                    onClick={choose("clone_git", () => {
                      showDialog({
                        id: "clone-git-repository",
                        size: "md",
                        title: "Clone Git Repository",
                        render: ({ hide }) => <CloneGitRepositoryDialog hide={hide} />,
                      });
                    })}
                  >
                    Clone repository
                  </Button>
                )}
                {canImport && (
                  <Button
                    size="xs"
                    variant="border"
                    color="secondary"
                    leftSlot={<Icon icon="import" size="sm" />}
                    disabled={busy != null}
                    onClick={choose("import_yaak", () => importData.mutateAsync())}
                  >
                    Import
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StartOption({
  color,
  icon,
  title,
  description,
  onClick,
  busy,
  disabled,
}: {
  color: Color;
  icon: IconProps["icon"];
  title: string;
  description: string;
  onClick: () => void;
  busy: boolean;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={classNames(
        "group w-full text-left rounded-lg px-3 py-2.5 border border-border-subtle",
        "grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3.5",
        "enabled:hocus:bg-surface-highlight/50 enabled:hocus:border-border",
        "outline-border-focus focus-visible:outline-2",
        disabled && !busy && "opacity-disabled",
      )}
    >
      {/* The banner theme tints this tile from the theme's own color for each option */}
      <div
        className={classNames(
          `x-theme-banner--${color}`,
          "size-10 rounded-md bg-surface-highlight grid place-items-center",
        )}
      >
        {busy ? <LoadingIcon size="sm" /> : <Icon icon={icon} color={color} size="md" />}
      </div>
      <div className="min-w-0">
        <div className="font-semibold text-text">{title}</div>
        <div className="text-sm text-text-subtle">{description}</div>
      </div>
      <Icon
        icon="chevron_right"
        className="text-text-subtlest group-enabled:group-hover:text-text-subtle group-enabled:group-focus-visible:text-text-subtle"
      />
    </button>
  );
}
