import { listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { type as osType } from "@tauri-apps/plugin-os";
import { setWindowTheme } from "@yaakapp-internal/mac-window";
import type { ModelPayload } from "@yaakapp-internal/models";
import type { Appearance } from "@yaakapp-internal/theme";
import {
  applyThemeToDocument,
  getCSSAppearance,
  subscribeToPreferredAppearanceChange,
  subscribeToSystemAppearanceChange,
} from "@yaakapp-internal/theme";
import { getSettings } from "./lib/settings";
import { getResolvedTheme } from "./lib/themes";

// NOTE: CSS appearance isn't as accurate as getting it async from the window (next step), but we want
//  a good appearance guess so we're not waiting too long
let preferredAppearance: Appearance = getInitialAppearance();
let linuxSystemAppearanceAvailable =
  osType() === "linux" && window.__YAAK_INITIAL_APPEARANCE_SOURCE__ === "linux-system";
let configureThemeGeneration = 0;
let windowShown = false;

configureThemeAndShow().catch((err) => console.log("Failed to configure theme", err));

subscribeToPreferredAppearanceChange(async (a) => {
  if (linuxSystemAppearanceAvailable) return;
  preferredAppearance = a;
  await configureThemeAndShow();
});

subscribeToSystemAppearanceChange(async (a) => {
  linuxSystemAppearanceAvailable = true;
  preferredAppearance = a;
  await configureThemeAndShow();
});

async function configureThemeAndShow() {
  const applied = await configureTheme();
  if (applied && !windowShown) {
    windowShown = true;
    // To prevent theme flashing, the backend hides new windows by default, so we
    // need to show it here, after configuring the theme for the first time.
    await getCurrentWebviewWindow().show();
  }
}

// Listen for settings changes, the re-compute theme
listen<ModelPayload>("model_write", async (event) => {
  if (event.payload.change.type !== "upsert") return;

  const model = event.payload.model.model;
  if (model !== "settings" && model !== "plugin") return;
  await configureThemeAndShow();
}).catch(console.error);

async function configureTheme(): Promise<boolean> {
  const generation = ++configureThemeGeneration;
  const settings = await getSettings();
  const theme = await getResolvedTheme(
    preferredAppearance,
    settings.appearance,
    settings.themeLight,
    settings.themeDark,
  );

  if (generation !== configureThemeGeneration) {
    return false;
  }

  applyThemeToDocument(theme.active);
  if (theme.active.base.surface != null) {
    setWindowTheme(theme.active.base.surface);
  }

  return true;
}

function getInitialAppearance(): Appearance {
  const initialAppearance = window.__YAAK_INITIAL_APPEARANCE__;
  if (initialAppearance === "dark" || initialAppearance === "light") {
    return initialAppearance;
  }
  return getCSSAppearance();
}

declare global {
  interface Window {
    __YAAK_INITIAL_APPEARANCE__?: Appearance;
    __YAAK_INITIAL_APPEARANCE_SOURCE__?: "settings" | "linux-system";
  }
}
