import type { GetThemesResponse } from "@yaakapp-internal/plugins";
import { defaultDarkTheme, defaultLightTheme } from "@yaakapp-internal/theme";
import { invokeCmd } from "../tauri";
import type { Appearance } from "./appearance";
import { resolveAppearance } from "./appearance";

export { defaultDarkTheme, defaultLightTheme } from "@yaakapp-internal/theme";

export async function getThemes() {
  const themes = (
    await invokeCmd<GetThemesResponse[]>("cmd_get_themes")
  ).flatMap((t) => t.themes);
  themes.sort((a, b) => a.label.localeCompare(b.label));
  // Remove duplicates, in case multiple plugins provide the same theme
  const uniqueThemes = Array.from(
    new Map(themes.map((t) => [t.id, t])).values(),
  );
  return { themes: [defaultDarkTheme, defaultLightTheme, ...uniqueThemes] };
}

export async function getResolvedTheme(
  preferredAppearance: Appearance,
  appearanceSetting: string,
  themeLight: string,
  themeDark: string,
) {
  const appearance = resolveAppearance(preferredAppearance, appearanceSetting);
  const { themes } = await getThemes();

  const darkThemes = themes.filter((t) => t.dark);
  const lightThemes = themes.filter((t) => !t.dark);

  const dark =
    darkThemes.find((t) => t.id === themeDark) ??
    darkThemes[0] ??
    defaultDarkTheme;
  const light =
    lightThemes.find((t) => t.id === themeLight) ??
    lightThemes[0] ??
    defaultLightTheme;

  const active = appearance === "dark" ? dark : light;

  return { dark, light, active };
}
