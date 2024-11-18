import type { Appearance } from './appearance';
import { resolveAppearance } from './appearance';
import { catppuccin } from './themes/catppuccin';
import { dracula } from './themes/dracula';
import { github } from './themes/github';
import { hotdogStand } from './themes/hotdog-stand';
import { monokaiPro } from './themes/monokai-pro';
import { moonlight } from './themes/moonlight';
import { relaxing } from './themes/relaxing';
import { rosePine } from './themes/rose-pine';
import { yaak, yaakDark, yaakLight } from './themes/yaak';
import { isThemeDark } from './window';

export const defaultDarkTheme = yaakDark;
export const defaultLightTheme = yaakLight;

const allThemes = [
  ...yaak,
  ...catppuccin,
  ...dracula,
  ...relaxing,
  ...rosePine,
  ...github,
  ...monokaiPro,
  ...moonlight,
  ...hotdogStand,
];

export function getThemes() {
  const dark = defaultDarkTheme;
  const light = defaultLightTheme;

  const otherThemes = allThemes
    .filter((t) => t.id !== dark.id && t.id !== light.id)
    .sort((a, b) => a.name.localeCompare(b.name));

  const themes = [dark, light, ...otherThemes];
  return { themes, fallback: { dark, light } };
}

export function getResolvedTheme(
  preferredAppearance: Appearance,
  appearanceSetting: string,
  themeLight: string,
  themeDark: string,
) {
  const appearance = resolveAppearance(preferredAppearance, appearanceSetting);
  const { themes, fallback } = getThemes();

  const darkThemes = themes.filter((t) => isThemeDark(t));
  const lightThemes = themes.filter((t) => !isThemeDark(t));

  const dark = darkThemes.find((t) => t.id === themeDark) ?? fallback.dark;
  const light = lightThemes.find((t) => t.id === themeLight) ?? fallback.light;

  const active = appearance === 'dark' ? dark : light;

  return { dark, light, active };
}
