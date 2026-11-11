import { getVersion } from "@tauri-apps/api/app";
import type { UpdateInfo, UpdateResponse, UpdateState } from "@yaakapp-internal/tauri-updater";
import {
  minPromiseMillis,
  type SettingsValues,
  showToast,
  showUpdateAvailableToast,
  showUpdateInstalledToast,
  showUpdateStateToast,
} from "@yaakapp-internal/ui";
import { atom, type createStore } from "jotai";
import { settingsValuesAtom } from "./interfaceSettings";
import { openLink } from "./opener";
import { broadcast, command, onWindowFocus, subscribeHere } from "./tauri";

type Store = ReturnType<typeof createStore>;

const APP_NAME = "Yaak Proxy";

/** The events the updater sends the window that checked, as Yaak's are named */
const UPDATE_AVAILABLE_EVENT = "update_available";
const UPDATE_INSTALLED_EVENT = "update_installed";
/** Where an update already in hand stands, for a check asked for meanwhile */
const UPDATE_STATE_EVENT = "update_state";

/** The app menu's Check for Updates…, sent to the window it was chosen in */
const CHECK_FOR_UPDATES_EVENT = "menu_check_for_updates";

/** How long after launch, or the window coming forward, a background check waits, as Yaak's */
const BACKGROUND_CHECK_DELAY_MS = 3000;

/** A check the user asked for is running, for the Settings button's spinner */
export const updateCheckingAtom = atom(false);

/** Whether this build has the updater; development builds don't */
export function updaterEnabled(): Promise<boolean> {
  return command<boolean>("cmd_updater_enabled");
}

/** What a check sends the backend: the channel and behavior the settings choose */
export function checkArgs(values: SettingsValues, background: boolean) {
  return {
    channel: values.updateChannel,
    background,
    autoDownload: values.autoDownloadUpdates,
  };
}

/**
 * Checks now, as the user asked, and says so when there is nothing newer or the server can't
 * be reached. An update found is offered by the prompt the backend sends this window.
 */
export async function checkForUpdatesNow(store: Store): Promise<void> {
  if (store.get(updateCheckingAtom)) return;
  store.set(updateCheckingAtom, true);
  try {
    const args = checkArgs(store.get(settingsValuesAtom), false);
    const found = await minPromiseMillis(command<boolean>("cmd_check_for_updates", args), 500);
    if (!found) {
      const version = await getVersion().catch(() => null);
      showToast(store, {
        id: "no-updates",
        color: "info",
        message:
          version == null
            ? "No update available. You are on the latest version."
            : `No update available. You are on the latest version, ${version}.`,
      });
    }
  } catch (err) {
    showToast(store, {
      id: "no-updates",
      color: "danger",
      message: `Could not check for updates: ${String(err)}`,
    });
  } finally {
    store.set(updateCheckingAtom, false);
  }
}

/** A quiet check, as the settings allow; the backend keeps to the channel's interval */
function checkInBackground(store: Store) {
  const values = store.get(settingsValuesAtom);
  if (!values.autoupdate) return;
  command<boolean>("cmd_check_for_updates", checkArgs(values, true)).catch((err) =>
    console.warn("Failed to check for updates", err),
  );
}

/** Offers an update the backend found, as Yaak does, and answers it */
async function offerUpdate(store: Store, info: UpdateInfo) {
  const { replyEventId } = info;
  const reply = (response: UpdateResponse) => broadcast(replyEventId, response);
  // Acknowledged at once, so the backend doesn't fall back to its native dialog
  if (info.install === "integrated") await reply({ type: "ack" });
  showUpdateAvailableToast(store, {
    appName: APP_NAME,
    update: info,
    onOpenUrl: (url) => openLink(url, (message) => showToast(store, { message, color: "danger" })),
    onInstall: () => reply({ type: "action", action: "install" }),
  });
}

/**
 * Hears the updater in this window: the prompt for an update it found, the offer to relaunch
 * once one installed, and the menu's Check for Updates…. With `background`, as the main window
 * does, also checks shortly after launch and each time the window comes forward.
 */
export async function syncUpdates(store: Store, { background }: { background: boolean }) {
  if (!(await updaterEnabled().catch(() => false))) return;
  subscribeHere<UpdateInfo>(UPDATE_AVAILABLE_EVENT, (info) => {
    offerUpdate(store, info).catch(console.error);
  });
  subscribeHere<UpdateState>(UPDATE_STATE_EVENT, (state) => {
    showUpdateStateToast(store, { appName: APP_NAME, state });
  });
  subscribeHere<string>(UPDATE_INSTALLED_EVENT, (version) => {
    showUpdateInstalledToast(store, {
      appName: APP_NAME,
      version,
      onRelaunch: () => {
        command<void>("cmd_restart").catch(console.error);
      },
    });
  });
  subscribeHere<void>(CHECK_FOR_UPDATES_EVENT, () => {
    checkForUpdatesNow(store).catch(console.error);
  });
  if (background) {
    const later = () => setTimeout(() => checkInBackground(store), BACKGROUND_CHECK_DELAY_MS);
    later();
    onWindowFocus(later);
  }
}
