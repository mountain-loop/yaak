import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
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

export function initTheme() {
  setPlatformOnDocument(platformFromUserAgent(navigator.userAgent));

  // Apply a quick initial theme based on CSS media query
  let preferredAppearance: Appearance = getCSSAppearance();
  applyTheme(preferredAppearance);

  // Then subscribe to accurate OS appearance detection and changes
  subscribeToPreferredAppearance((a) => {
    preferredAppearance = a;
    applyTheme(preferredAppearance);
  });

  // Show window after initial theme is applied (window starts hidden to prevent flash)
  getCurrentWebviewWindow().show().catch(console.error);
}

function applyTheme(appearance: Appearance) {
  const theme = appearance === "dark" ? defaultDarkTheme : defaultLightTheme;
  applyThemeToDocument(theme);
  if (theme.base.surface != null) {
    setWindowTheme(theme.base.surface);
  }
}
