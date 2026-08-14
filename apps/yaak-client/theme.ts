import { platform } from "@yaakapp-internal/platform";
import { setWindowTheme } from "@yaakapp-internal/mac-window";
import type { ModelPayload } from "@yaakapp-internal/models";
import type { Appearance } from "@yaakapp-internal/theme";
import {
  applyThemeToDocument,
  getCSSAppearance,
  getSystemAppearance,
  getWindowAppearance,
  subscribeToPreferredAppearanceChange,
} from "@yaakapp-internal/theme";
import { getSettings } from "./lib/settings";
import { getResolvedTheme } from "./lib/themes";

// NOTE: The appearance the OS prefers (never the one the settings force). The backend
//  injects it on macOS and Linux; the CSS guess is only a fallback until the async
//  window value arrives below.
let preferredAppearance: Appearance = getSystemAppearance() ?? getCSSAppearance();
let configureThemeGeneration = 0;
let windowShown = false;

configureThemeAndShow().catch((err) => console.log("Failed to configure theme", err));

if (getSystemAppearance() == null) {
  // The initial appearance is only a guess, so confirm it with the window once it's available
  getWindowAppearance()
    .then(async (a) => {
      if (a === preferredAppearance) return;
      preferredAppearance = a;
      await configureThemeAndShow();
    })
    .catch((err) => console.log("Failed to get window appearance", err));
}

subscribeToPreferredAppearanceChange(async (a) => {
  preferredAppearance = a;
  await configureThemeAndShow();
});

async function configureThemeAndShow() {
  const applied = await configureTheme();
  if (applied && !windowShown) {
    windowShown = true;
    // To prevent theme flashing, the backend hides new windows by default, so we
    // need to show it here, after configuring the theme for the first time.
    await platform.window.show();
  }
}

// Listen for settings changes, the re-compute theme
platform.listen<ModelPayload[]>("model_writes", async (payloads) => {
  const relevant = payloads.some(
    (p) =>
      p.change.type === "upsert" &&
      (p.model.model === "settings" || p.model.model === "plugin"),
  );
  if (!relevant) return;
  await configureThemeAndShow();
});

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
