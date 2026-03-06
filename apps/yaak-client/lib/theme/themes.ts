import type { GetThemesResponse } from '@yaakapp-internal/plugins';
import { invokeCmd } from '../tauri';
import type { Appearance } from './appearance';
import { resolveAppearance } from './appearance';

export async function getThemes() {
  const themes = (await invokeCmd<GetThemesResponse[]>('cmd_get_themes')).flatMap((t) => t.themes);
  themes.sort((a, b) => a.label.localeCompare(b.label));
  // Remove duplicates, in case multiple plugins provide the same theme
  const uniqueThemes = Array.from(new Map(themes.map((t) => [t.id, t])).values());
  return { themes: [yaakDark, yaakLight, ...uniqueThemes] };
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

  const dark = darkThemes.find((t) => t.id === themeDark) ?? darkThemes[0] ?? yaakDark;
  const light = lightThemes.find((t) => t.id === themeLight) ?? lightThemes[0] ?? yaakLight;

  const active = appearance === 'dark' ? dark : light;

  return { dark, light, active };
}

const yaakDark = {
  id: 'yaak-dark',
  label: 'Yaak',
  dark: true,
  base: {
    surface: 'hsl(244,23%,14%)',
    surfaceHighlight: 'hsl(244,23%,20%)',
    text: 'hsl(245,23%,85%)',
    textSubtle: 'hsl(245,18%,58%)',
    textSubtlest: 'hsl(245,18%,45%)',
    border: 'hsl(244,23%,25%)',
    primary: 'hsl(266,100%,79%)',
    secondary: 'hsl(245,23%,60%)',
    info: 'hsl(206,100%,63%)',
    success: 'hsl(150,99%,44%)',
    notice: 'hsl(48,80%,63%)',
    warning: 'hsl(28,100%,61%)',
    danger: 'hsl(342,90%,68%)',
  },
  components: {
    button: {
      primary: 'hsl(266,100%,71.1%)',
      secondary: 'hsl(244,23%,54%)',
      info: 'hsl(206,100%,56.7%)',
      success: 'hsl(150,99%,37.4%)',
      notice: 'hsl(48,80%,50.4%)',
      warning: 'hsl(28,100%,54.9%)',
      danger: 'hsl(342,90%,61.2%)',
    },
    dialog: {
      border: 'hsl(244,23%,24%)',
    },
    sidebar: {
      surface: 'hsl(243,23%,16%)',
      border: 'hsl(244,23%,22%)',
    },
    responsePane: {
      surface: 'hsl(243,23%,16%)',
      border: 'hsl(246,23%,23%)',
    },
    appHeader: {
      surface: 'hsl(244,23%,12%)',
      border: 'hsl(244,23%,21%)',
    },
  },
};

const yaakLight = {
  id: 'yaak-light',
  label: 'Yaak',
  dark: false,
  base: {
    surface: 'hsl(0,0%,100%)',
    surfaceHighlight: 'hsl(218,24%,87%)',
    text: 'hsl(217,24%,10%)',
    textSubtle: 'hsl(217,24%,40%)',
    textSubtlest: 'hsl(217,24%,58%)',
    border: 'hsl(217,22%,90%)',
    primary: 'hsl(266,100%,60%)',
    secondary: 'hsl(220,24%,50%)',
    info: 'hsl(206,100%,40%)',
    success: 'hsl(139,66%,34%)',
    notice: 'hsl(45,100%,34%)',
    warning: 'hsl(30,100%,36%)',
    danger: 'hsl(335,75%,48%)',
  },
  components: {
    sidebar: {
      surface: 'hsl(220,20%,98%)',
      border: 'hsl(217,22%,88%)',
      surfaceHighlight: 'hsl(217,25%,90%)',
    },
  },
};

export const defaultDarkTheme = yaakDark;
export const defaultLightTheme = yaakLight;
