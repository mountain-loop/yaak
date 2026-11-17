import type { SettingsPatch, SettingsValues } from "@yaakapp-internal/ui";
import { atom, type createStore } from "jotai";
import { readSettingsValues, SETTINGS_VALUES_KEY } from "./settings";
import { broadcast, currentWindowLabel, subscribe } from "./tauri";

type Store = ReturnType<typeof createStore>;

/** Sent with the values after a change, so every window of the app takes them */
const SETTINGS_VALUES_EVENT = "settings_values_changed";

interface SettingsValuesChanged {
  /** The window they were changed in, which has taken them already */
  from: string;
  values: SettingsValues;
}

/** The shared settings tabs' values, kept in local storage */
const valuesAtom = atom<SettingsValues>(
  readSettingsValues(localStorage.getItem(SETTINGS_VALUES_KEY)),
);

/** Takes `next` in this window: the values, the sizes and, if it changed, the appearance */
const takeValuesAtom = atom(null, (get, set, next: SettingsValues) => {
  const prev = get(valuesAtom);
  set(valuesAtom, next);
  applyFontSizes(next);
  if (next.appearance !== prev.appearance) {
    // Loaded on demand: the theme module shows the window as it loads
    import("./theme").then((m) => m.setChosenAppearance(next.appearance)).catch(console.error);
  }
});

/** Reads the values, and writes a patch of them through to storage and every window */
export const settingsValuesAtom = atom(
  (get) => get(valuesAtom),
  (get, set, patch: SettingsPatch) => {
    const next = { ...get(valuesAtom), ...patch };
    set(takeValuesAtom, next);
    localStorage.setItem(SETTINGS_VALUES_KEY, JSON.stringify(next));
    const message: SettingsValuesChanged = { from: currentWindowLabel(), values: next };
    broadcast(SETTINGS_VALUES_EVENT, message).catch((err) =>
      console.warn("Failed to send the settings to the other windows", err),
    );
  },
);

/** Takes the values another window changes, such as the theme or sizes set in Settings */
export function syncSettingsValues(store: Store) {
  const here = currentWindowLabel();
  subscribe<SettingsValuesChanged>(SETTINGS_VALUES_EVENT, ({ from, values }) => {
    if (from === here) return;
    // Read as storage is, so a value of the wrong shape falls back to its default
    store.set(takeValuesAtom, readSettingsValues(JSON.stringify(values)));
  });
}

/** The interface and editor sizes, the editor's through the variable the editors read */
export function applyFontSizes(
  values: Pick<SettingsValues, "interfaceFontSize" | "editorFontSize">,
) {
  const root = document.documentElement;
  root.style.fontSize = `${values.interfaceFontSize}px`;
  root.style.setProperty("--editor-font-size", `${values.editorFontSize}px`);
}
