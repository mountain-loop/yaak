import { setWindowTheme } from "@yaakapp-internal/mac-window";
import {
  applyThemeToDocument,
  defaultDarkTheme,
  defaultLightTheme,
  getCSSAppearance,
  platformFromUserAgent,
  setPlatformOnDocument,
  subscribeToPreferredAppearance,
  type Appearance,
} from "@yaakapp-internal/theme";
import { readSettingsValues, resolveAppearance, SETTINGS_VALUES_KEY } from "./settings";
import { showWindow } from "./tauri";

setPlatformOnDocument(platformFromUserAgent(navigator.userAgent));

// The appearance chosen in Settings, `system` following the OS's
let chosenAppearance = readSettingsValues(localStorage.getItem(SETTINGS_VALUES_KEY)).appearance;

// Apply a quick initial theme based on CSS media query
let preferredAppearance: Appearance = getCSSAppearance();
applyTheme();

// Then subscribe to accurate OS appearance detection and changes
subscribeToPreferredAppearance((a) => {
  preferredAppearance = a;
  applyTheme();
});

// Show window after initial theme is applied (window starts hidden to prevent flash)
showWindow().catch(console.error);

/** Applies the appearance chosen in Settings: `light`, `dark` or `system` */
export function setChosenAppearance(appearance: string) {
  chosenAppearance = appearance;
  applyTheme();
}

function applyTheme() {
  const appearance = resolveAppearance(chosenAppearance, preferredAppearance);
  const theme = appearance === "dark" ? defaultDarkTheme : defaultLightTheme;
  applyThemeToDocument(theme);
  if (theme.base.surface != null) {
    setWindowTheme(theme.base.surface);
  }
}
