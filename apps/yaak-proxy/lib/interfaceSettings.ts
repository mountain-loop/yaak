import type { SettingsPatch, SettingsValues } from "@yaakapp-internal/ui";
import { atom } from "jotai";
import { readSettingsValues, SETTINGS_VALUES_KEY } from "./settings";

/** The shared settings tabs' values, kept in local storage */
const valuesAtom = atom<SettingsValues>(
  readSettingsValues(localStorage.getItem(SETTINGS_VALUES_KEY)),
);

/** Reads the values, and writes a patch of them through to storage and the window */
export const settingsValuesAtom = atom(
  (get) => get(valuesAtom),
  (get, set, patch: SettingsPatch) => {
    const next = { ...get(valuesAtom), ...patch };
    set(valuesAtom, next);
    localStorage.setItem(SETTINGS_VALUES_KEY, JSON.stringify(next));
    applyFontSizes(next);
    if (patch.appearance != null) {
      // Loaded on demand: the theme module shows the window as it loads
      import("./theme").then((m) => m.setChosenAppearance(next.appearance)).catch(console.error);
    }
  },
);

/** The interface and editor sizes, the editor's through the variable the editors read */
export function applyFontSizes(values: Pick<SettingsValues, "interfaceFontSize" | "editorFontSize">) {
  const root = document.documentElement;
  root.style.fontSize = `${values.interfaceFontSize}px`;
  root.style.setProperty("--editor-font-size", `${values.editorFontSize}px`);
}
