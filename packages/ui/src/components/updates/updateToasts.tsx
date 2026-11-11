import type { createStore } from "jotai";
import { showToast } from "../../lib/toast";
import { Button } from "../Button";
import { ButtonInfiniteLoading } from "../ButtonInfiniteLoading";
import { Icon } from "../Icon";
import { InlineCode } from "../InlineCode";
import { HStack, VStack } from "../Stacks";

type Store = ReturnType<typeof createStore>;

/** The one toast an app's update shows, replaced as it moves from available to installed */
export const UPDATE_TOAST_ID = "update-info";

/** An available update, as the app's updater describes it */
export interface UpdateToastInfo {
  version: string;
  /** Downloaded already, so installing needs no download */
  downloaded: boolean;
  /** `integrated` when the app installs it itself; otherwise the user is told how to update */
  install: "integrated" | "flatpak" | "manual";
}

export interface ShowUpdateAvailableToastArgs {
  /** As the copy says it: `Yaak`, `Yaak Proxy` */
  appName: string;
  update: UpdateToastInfo;
  /** The release notes for this version; no What's New button without them */
  whatsNewUrl?: string;
  /** Where to download the app by hand, for an install that can't update itself */
  downloadUrl?: string;
  onOpenUrl: (url: string) => void | Promise<void>;
  /** The user chose to install an `integrated` update */
  onInstall: () => void | Promise<void>;
}

/** Offers an available update: to install it, or, where the app can't, says how to get it */
export function showUpdateAvailableToast(
  store: Store,
  { appName, update, whatsNewUrl, downloadUrl, onOpenUrl, onInstall }: ShowUpdateAvailableToastArgs,
) {
  const { version, downloaded, install } = update;

  const whatsNewButton = whatsNewUrl != null && (
    <Button
      size="xs"
      color="info"
      variant="border"
      rightSlot={<Icon icon="external_link" />}
      onClick={async () => {
        await onOpenUrl(whatsNewUrl);
      }}
    >
      What&apos;s New
    </Button>
  );

  if (install !== "integrated") {
    const flatpak = install === "flatpak";
    return showToast(store, {
      id: UPDATE_TOAST_ID,
      color: "info",
      timeout: null,
      message: (
        <VStack>
          <h2 className="font-semibold">
            {appName} {version} is available
          </h2>
          <p className="text-text-subtle text-sm">
            {flatpak ? (
              <>
                Update with <InlineCode>flatpak update</InlineCode> or your software center.
              </>
            ) : (
              "Download the new version to upgrade."
            )}
          </p>
        </VStack>
      ),
      action: () => (
        <HStack space={1.5}>
          {!flatpak && downloadUrl != null && (
            <Button
              size="xs"
              color="info"
              rightSlot={<Icon icon="external_link" />}
              onClick={async () => {
                await onOpenUrl(downloadUrl);
              }}
            >
              Download
            </Button>
          )}
          {whatsNewButton}
        </HStack>
      ),
    });
  }

  return showToast(store, {
    id: UPDATE_TOAST_ID,
    color: "info",
    timeout: null,
    message: (
      <VStack>
        <h2 className="font-semibold">
          {appName} {version} is available
        </h2>
        <p className="text-text-subtle text-sm">
          {downloaded ? "Do you want to install" : "Download and install"} the update?
        </p>
      </VStack>
    ),
    action: () => (
      <HStack space={1.5}>
        <ButtonInfiniteLoading
          size="xs"
          color="info"
          className="min-w-40"
          loadingChildren={downloaded ? "Installing..." : "Downloading..."}
          onClick={async () => {
            await onInstall();
          }}
        >
          {downloaded ? "Install Now" : "Download and Install"}
        </ButtonInfiniteLoading>
        {whatsNewButton}
      </HStack>
    ),
  });
}

/** The toast saying where an update already in hand stands, apart from its prompt */
export const UPDATE_STATE_TOAST_ID = "update-state";

/** Where an app's update stands, as its updater reports it */
export type UpdateToastState =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "offered" | "downloading" | "installing" | "installed"; version: string };

/** What the user who asked for a check is told while an update is already in hand */
export function updateStateMessage(appName: string, state: UpdateToastState): string | null {
  switch (state.state) {
    case "idle":
      return null;
    case "checking":
      return "Already checking for updates.";
    case "offered":
      return `${appName} ${state.version} is available.`;
    case "downloading":
      return `${appName} ${state.version} is downloading.`;
    case "installing":
      return `${appName} ${state.version} is installing.`;
    case "installed":
      return `${appName} ${state.version} is installed. Relaunch to start using it.`;
  }
}

/**
 * Tells the user who asked for a check where the update already in hand stands, instead of
 * starting another. The prompt it belongs to, if any, keeps its own toast.
 */
export function showUpdateStateToast(
  store: Store,
  { appName, state }: { appName: string; state: UpdateToastState },
) {
  const message = updateStateMessage(appName, state);
  if (message == null) return null;
  return showToast(store, { id: UPDATE_STATE_TOAST_ID, color: "info", message });
}

export interface ShowUpdateInstalledToastArgs {
  appName: string;
  version: string;
  /** Relaunch the app into the installed version */
  onRelaunch: () => void;
}

/** Says an update installed and offers to relaunch into it */
export function showUpdateInstalledToast(
  store: Store,
  { appName, version, onRelaunch }: ShowUpdateInstalledToastArgs,
) {
  return showToast(store, {
    id: UPDATE_TOAST_ID,
    color: "primary",
    timeout: null,
    message: (
      <VStack>
        <h2 className="font-semibold">
          {appName} {version} was installed
        </h2>
        <p className="text-text-subtle text-sm">Start using the new version now?</p>
      </VStack>
    ),
    action: ({ hide }) => (
      <ButtonInfiniteLoading
        size="xs"
        className="mr-auto min-w-20"
        color="primary"
        loadingChildren="Restarting..."
        onClick={() => {
          hide();
          setTimeout(onRelaunch, 200);
        }}
      >
        Relaunch {appName}
      </ButtonInfiniteLoading>
    ),
  });
}
