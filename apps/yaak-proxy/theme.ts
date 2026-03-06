import {
  applyThemeToDocument,
  defaultDarkTheme,
  platformFromUserAgent,
  setPlatformOnDocument,
} from "@yaakapp-internal/theme";

setPlatformOnDocument(platformFromUserAgent(navigator.userAgent));
applyThemeToDocument(defaultDarkTheme);
