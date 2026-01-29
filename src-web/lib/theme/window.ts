import type { Theme, ThemeComponentColors } from '@yaakapp-internal/plugins';
import { defaultDarkTheme, defaultLightTheme } from './themes';
import { YaakColor } from './yaakColor';

export type YaakColors = {
  surface: YaakColor;
  surfaceHighlight?: YaakColor;
  surfaceActive?: YaakColor;

  text: YaakColor;
  textSubtle?: YaakColor;
  textSubtlest?: YaakColor;

  border?: YaakColor;
  borderSubtle?: YaakColor;
  borderFocus?: YaakColor;

  shadow?: YaakColor;
  backdrop?: YaakColor;
  selection?: YaakColor;

  primary?: YaakColor;
  secondary?: YaakColor;
  info?: YaakColor;
  success?: YaakColor;
  notice?: YaakColor;
  warning?: YaakColor;
  danger?: YaakColor;
};

export type YaakTheme = {
  id: string;
  name: string;
  base: YaakColors;
  components?: Partial<{
    dialog: Partial<YaakColors>;
    menu: Partial<YaakColors>;
    toast: Partial<YaakColors>;
    sidebar: Partial<YaakColors>;
    responsePane: Partial<YaakColors>;
    appHeader: Partial<YaakColors>;
    button: Partial<YaakColors>;
    banner: Partial<YaakColors>;
    templateTag: Partial<YaakColors>;
    urlBar: Partial<YaakColors>;
    editor: Partial<YaakColors>;
    input: Partial<YaakColors>;
  }>;
};

export type YaakColorKey = keyof ThemeComponentColors;

type ComponentName = keyof NonNullable<YaakTheme['components']>;

type CSSVariables = Record<YaakColorKey, string | undefined>;

function themeVariables(
  theme: Theme,
  component?: ComponentName,
  base?: CSSVariables,
): CSSVariables | null {
  const cmp =
    component == null
      ? theme.base
      : (theme.components?.[component] ?? ({} as ThemeComponentColors));
  const c = (s: string | undefined) => yc(theme, s);
  const vars: CSSVariables = {
    surface: cmp.surface,
    surfaceHighlight: cmp.surfaceHighlight ?? c(cmp.surface)?.lift(0.06).css(),
    surfaceActive: cmp.surfaceActive ?? c(cmp.primary)?.lower(0.2).translucify(0.8).css(),
    backdrop: cmp.backdrop ?? c(cmp.surface)?.lower(0.2).translucify(0.2).css(),
    selection: cmp.selection ?? c(cmp.primary)?.lower(0.1).translucify(0.7).css(),
    border: cmp.border ?? c(cmp.surface)?.lift(0.11)?.css(),
    borderSubtle: cmp.borderSubtle ?? c(cmp.border)?.lower(0.06)?.css(),
    borderFocus: c(cmp.info)?.translucify(0.5)?.css(),
    text: cmp.text,
    textSubtle: cmp.textSubtle ?? c(cmp.text)?.lower(0.2)?.css(),
    textSubtlest: cmp.textSubtlest ?? c(cmp.text)?.lower(0.3)?.css(),
    shadow:
      cmp.shadow ??
      YaakColor.black()
        .translucify(theme.dark ? 0.7 : 0.93)
        .css(),
    primary: cmp.primary,
    secondary: cmp.secondary,
    info: cmp.info,
    success: cmp.success,
    notice: cmp.notice,
    warning: cmp.warning,
    danger: cmp.danger,
  };

  // Extend with base
  for (const [k, v] of Object.entries(vars)) {
    if (!v && base?.[k as YaakColorKey]) {
      vars[k as YaakColorKey] = base[k as YaakColorKey];
    }
  }

  return vars;
}

function templateTagColorVariables(color: YaakColor | null): Partial<CSSVariables> {
  if (color == null) return {};

  return {
    text: color.lift(0.7).css(),
    textSubtle: color.lift(0.4).css(),
    textSubtlest: color.css(),
    surface: color.lower(0.2).translucify(0.8).css(),
    border: color.translucify(0.6).css(),
    borderSubtle: color.translucify(0.8).css(),
    surfaceHighlight: color.lower(0.1).translucify(0.7).css(),
  };
}

function toastColorVariables(color: YaakColor | null): Partial<CSSVariables> {
  if (color == null) return {};

  return {
    text: color.lift(0.8).css(),
    textSubtle: color.lift(0.8).translucify(0.3).css(),
    surface: color.translucify(0.9).css(),
    surfaceHighlight: color.translucify(0.8).css(),
    border: color.lift(0.3).translucify(0.6).css(),
  };
}

function bannerColorVariables(color: YaakColor | null): Partial<CSSVariables> {
  if (color == null) return {};

  return {
    text: color.lift(0.8).css(),
    textSubtle: color.translucify(0.3).css(),
    textSubtlest: color.translucify(0.6).css(),
    surface: color.translucify(0.95).css(),
    border: color.lift(0.3).translucify(0.8).css(),
  };
}

function inputCSS(color: YaakColor | null): Partial<CSSVariables> {
  if (color == null) return {};

  const theme: Partial<ThemeComponentColors> = {
    border: color.css(),
  };

  return theme;
}

function buttonSolidColorVariables(
  color: YaakColor | null,
  isDefault = false,
): Partial<CSSVariables> {
  if (color == null) return {};

  const theme: Partial<ThemeComponentColors> = {
    text: 'white',
    surface: color.lower(0.3).css(),
    surfaceHighlight: color.lower(0.1).css(),
    border: color.css(),
  };

  if (isDefault) {
    theme.text = undefined; // Inherit from parent
    theme.surface = undefined; // Inherit from parent
    theme.surfaceHighlight = color.lift(0.08).css();
  }

  return theme;
}

function buttonBorderColorVariables(
  color: YaakColor | null,
  isDefault = false,
): Partial<CSSVariables> {
  if (color == null) return {};

  const vars: Partial<CSSVariables> = {
    text: color.lift(0.8).css(),
    textSubtle: color.lift(0.55).css(),
    textSubtlest: color.lift(0.4).translucify(0.6).css(),
    surfaceHighlight: color.translucify(0.8).css(),
    borderSubtle: color.translucify(0.5).css(),
    border: color.translucify(0.3).css(),
  };

  if (isDefault) {
    vars.borderSubtle = color.lift(0.28).css();
    vars.border = color.lift(0.5).css();
  }

  return vars;
}

function variablesToCSS(
  selector: string | null,
  vars: Partial<CSSVariables> | null,
): string | null {
  if (vars == null) {
    return null;
  }

  const css = Object.entries(vars ?? {})
    .filter(([, value]) => value)
    .map(([name, value]) => `--${name}: ${value};`)
    .join('\n');

  return selector == null ? css : `${selector} {\n${indent(css)}\n}`;
}

function componentCSS(theme: Theme, component: ComponentName): string | null {
  if (theme.components == null) {
    return null;
  }

  const themeVars = themeVariables(theme, component);
  return variablesToCSS(`.x-theme-${component}`, themeVars);
}

function buttonCSS(
  theme: Theme,
  color: YaakColorKey,
  colors?: ThemeComponentColors,
): string | null {
  const yaakColor = yc(theme, colors?.[color]);
  if (yaakColor == null) {
    return null;
  }

  return [
    variablesToCSS(`.x-theme-button--solid--${color}`, buttonSolidColorVariables(yaakColor)),
    variablesToCSS(`.x-theme-button--border--${color}`, buttonBorderColorVariables(yaakColor)),
  ].join('\n\n');
}

function bannerCSS(
  theme: Theme,
  color: YaakColorKey,
  colors?: ThemeComponentColors,
): string | null {
  const yaakColor = yc(theme, colors?.[color]);
  if (yaakColor == null) {
    return null;
  }

  return [variablesToCSS(`.x-theme-banner--${color}`, bannerColorVariables(yaakColor))].join(
    '\n\n',
  );
}

function toastCSS(theme: Theme, color: YaakColorKey, colors?: ThemeComponentColors): string | null {
  const yaakColor = yc(theme, colors?.[color]);
  if (yaakColor == null) {
    return null;
  }

  return [variablesToCSS(`.x-theme-toast--${color}`, toastColorVariables(yaakColor))].join('\n\n');
}

function templateTagCSS(
  theme: Theme,
  color: YaakColorKey,
  colors?: ThemeComponentColors,
): string | null {
  const yaakColor = yc(theme, colors?.[color]);
  if (yaakColor == null) {
    return null;
  }

  return [
    variablesToCSS(`.x-theme-templateTag--${color}`, templateTagColorVariables(yaakColor)),
  ].join('\n\n');
}

export function getThemeCSS(theme: Theme): string {
  theme.components = theme.components ?? {};
  // Toast defaults to menu styles
  theme.components.toast = theme.components.toast ?? theme.components.menu ?? {};
  const { components, id, label } = theme;
  const colors = Object.keys(theme.base).reduce((prev, key) => {
    // biome-ignore lint/performance/noAccumulatingSpread: none
    return { ...prev, [key]: theme.base[key as YaakColorKey] };
  }, {}) as ThemeComponentColors;

  let themeCSS = '';
  try {
    const baseCss = variablesToCSS(null, themeVariables(theme));
    themeCSS = [
      baseCss,
      ...Object.keys(components ?? {}).map((key) => componentCSS(theme, key as ComponentName)),
      variablesToCSS(
        '.x-theme-button--solid--default',
        buttonSolidColorVariables(yc(theme, theme.base.surface), true),
      ),
      variablesToCSS(
        '.x-theme-button--border--default',
        buttonBorderColorVariables(yc(theme, theme.base.surface), true),
      ),
      ...Object.keys(colors ?? {}).map((key) =>
        buttonCSS(theme, key as YaakColorKey, theme.components?.button ?? colors),
      ),
      ...Object.keys(colors ?? {}).map((key) =>
        bannerCSS(theme, key as YaakColorKey, theme.components?.banner ?? colors),
      ),
      ...Object.keys(colors ?? {}).map((key) =>
        toastCSS(theme, key as YaakColorKey, theme.components?.banner ?? colors),
      ),
      ...Object.keys(colors ?? {}).map((key) =>
        templateTagCSS(theme, key as YaakColorKey, theme.components?.templateTag ?? colors),
      ),
    ].join('\n\n');
  } catch (err) {
    console.error('Failed to generate CSS', err);
  }

  return [`/* ${label} */`, `[data-theme="${id}"] {`, indent(themeCSS), '}'].join('\n');
}

export function addThemeStylesToDocument(rawTheme: Theme | null) {
  if (rawTheme == null) {
    console.error('Failed to add theme styles: theme is null');
    return;
  }

  const theme = completeTheme(rawTheme);
  let styleEl = document.head.querySelector('style[data-theme]');
  if (!styleEl) {
    styleEl = document.createElement('style');
    document.head.appendChild(styleEl);
  }

  styleEl.setAttribute('data-theme', theme.id);
  styleEl.setAttribute('data-updated-at', new Date().toISOString());
  styleEl.textContent = getThemeCSS(theme);
}

export function setThemeOnDocument(theme: Theme | null) {
  if (theme == null) {
    console.error('Failed to set theme: theme is null');
    return;
  }

  document.documentElement.setAttribute('data-theme', theme.id);
}

export function indent(text: string, space = '    '): string {
  return text
    .split('\n')
    .map((line) => space + line)
    .join('\n');
}

function yc<T extends string | null | undefined>(
  theme: Theme,
  s: T,
): T extends string ? YaakColor : null {
  if (s == null) return null as never;
  return new YaakColor(s, theme.dark ? 'dark' : 'light') as never;
}

export function completeTheme(theme: Theme): Theme {
  const fallback = theme.dark ? defaultDarkTheme.base : defaultLightTheme.base;
  const c = (s: string | null | undefined) => yc(theme, s);

  theme.base.primary ??= fallback.primary;
  theme.base.secondary ??= fallback.secondary;
  theme.base.info ??= fallback.info;
  theme.base.success ??= fallback.success;
  theme.base.notice ??= fallback.notice;
  theme.base.warning ??= fallback.warning;
  theme.base.danger ??= fallback.danger;

  theme.base.surface ??= fallback.surface;
  theme.base.surfaceHighlight ??= c(theme.base.surface)?.lift(0.06)?.css();
  theme.base.surfaceActive ??= c(theme.base.primary)?.lower(0.2).translucify(0.8).css();

  theme.base.border ??= c(theme.base.surface)?.lift(0.12)?.css();
  theme.base.borderSubtle ??= c(theme.base.border)?.lower(0.08)?.css();

  theme.base.text ??= fallback.text;
  theme.base.textSubtle ??= c(theme.base.text)?.lower(0.3)?.css();
  theme.base.textSubtlest ??= c(theme.base.text)?.lower(0.5)?.css();

  return theme;
}
