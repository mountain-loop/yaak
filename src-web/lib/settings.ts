import { invoke } from "@tauri-apps/api/core";
import type { Settings } from "@yaakapp-internal/models";
import { isTauriRuntime } from "./tauri";

export function getSettings(): Promise<Settings> {
  if (typeof invoke !== "function" || !isTauriRuntime()) {
    return Promise.resolve({
      model: "settings",
      id: "n/a",
      appearance: "system",
      themeLight: null,
      themeDark: null,
      editorFont: null,
      interfaceFont: null,
    } as unknown as Settings);
  }

  try {
    return invoke<Settings>("models_get_settings").catch(() => {
      return {
        model: "settings",
        id: "n/a",
        appearance: "system",
        themeLight: null,
        themeDark: null,
        editorFont: null,
        interfaceFont: null,
      } as unknown as Settings;
    });
  } catch {
    return Promise.resolve({
      model: "settings",
      id: "n/a",
      appearance: "system",
      themeLight: null,
      themeDark: null,
      editorFont: null,
      interfaceFont: null,
    } as unknown as Settings);
  }
}
