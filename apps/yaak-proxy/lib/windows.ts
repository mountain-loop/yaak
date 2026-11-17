/**
 * The Settings window's label, which `cmd_open_settings` gives it: opened as a child of the
 * main window, as Yaak's, it takes the prefix the shared window code gives child windows
 */
export const SETTINGS_WINDOW_LABEL = "other__settings";

/** The event that moves an open Settings window to another tab */
export const SETTINGS_TAB_EVENT = "settings_tab";

/** Labels the app's main windows start with, as the shared window code names them */
const MAIN_WINDOW_PREFIX = "main_";

/**
 * What a page renders, by its window's label: the Settings window holds the settings alone,
 * a main window the app. Anything else, such as the browser harness, renders the app in a
 * page of its own, with no second window to open.
 */
export type WindowKind = "main" | "settings" | "page";

export function windowKind(label: string): WindowKind {
  if (label === SETTINGS_WINDOW_LABEL) return "settings";
  if (label.startsWith(MAIN_WINDOW_PREFIX)) return "main";
  return "page";
}

/** The app can open Settings in a window of its own, rather than a dialog over this one */
export function opensWindows(kind: WindowKind): boolean {
  return kind !== "page";
}

/** How Settings opens: a window of its own where there is one to give, a dialog otherwise */
export interface OpenSettingsVia {
  kind: WindowKind;
  /** Opens the Settings window, or brings it forward, on the tab if one is given */
  openWindow: (tab: string | null) => Promise<void>;
  /** Opens the dialog on the tab, or keeps it where it is when none is given */
  openDialog: (tab: string | null) => void;
}

export function openSettingsVia(tab: string | null, via: OpenSettingsVia): Promise<void> {
  if (!opensWindows(via.kind)) {
    via.openDialog(tab);
    return Promise.resolve();
  }
  return via.openWindow(tab);
}

/** The tab `cmd_open_settings` asked a new Settings window to open on, if it asked */
export function requestedSettingsTab(): string | null {
  const tab = (globalThis as { __YAAK_SETTINGS_TAB__?: unknown }).__YAAK_SETTINGS_TAB__;
  return typeof tab === "string" ? tab : null;
}
