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

export type YaakTheme = YaakColors & {
  id: string;
  name: string;
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

export type YaakColorKey = keyof YaakColors;

type ComponentName = keyof NonNullable<YaakTheme['components']>;

type CSSVariables = Record<YaakColorKey, YaakColor | undefined>;

function themeVariables(theme?: Partial<YaakColors>, base?: CSSVariables): CSSVariables | null {
  const vars: CSSVariables = {
    surface: theme?.surface,
    surfaceHighlight: theme?.surfaceHighlight ?? theme?.surface?.lift(0.06),
    surfaceActive: theme?.surfaceActive ?? theme?.primary?.lower(0.2).translucify(0.8),
    backdrop: theme?.surface?.lower(0.2).translucify(0.2),
    selection: theme?.primary?.lower(0.1).translucify(0.7),
    border: theme?.border ?? theme?.surface?.lift(0.11),
    borderSubtle: theme?.borderSubtle ?? theme?.border?.lower(0.06),
    borderFocus: theme?.info?.translucify(0.5),
    text: theme?.text,
    textSubtle: theme?.textSubtle ?? theme?.text?.lower(0.2),
    textSubtlest: theme?.textSubtlest ?? theme?.text?.lower(0.3),
    shadow:
      theme?.shadow ??
      YaakColor.black().translucify(isThemeDark(theme ?? ({} as Partial<YaakColors>)) ? 0.7 : 0.93),
    primary: theme?.primary,
    secondary: theme?.secondary,
    info: theme?.info,
    success: theme?.success,
    notice: theme?.notice,
    warning: theme?.warning,
    danger: theme?.danger,
  };

  // Extend with base
  for (const [k, v] of Object.entries(vars)) {
    if (!v && base?.[k as YaakColorKey]) {
      vars[k as YaakColorKey] = base[k as YaakColorKey];
    }
  }

  return vars;
}

function templateTagColorVariables(color: YaakColor): Partial<CSSVariables> {
  return {
    text: color.lift(0.6),
    textSubtle: color.lift(0.4),
    textSubtlest: color,
    surface: color.lower(0.2).translucify(0.8),
    border: color.lower(0.2).translucify(0.2),
    surfaceHighlight: color.lower(0.1).translucify(0.7),
  };
}

function toastColorVariables(color: YaakColor): Partial<CSSVariables> {
  return {
    text: color.lift(0.8),
    textSubtle: color,
    surface: color.translucify(0.9),
    surfaceHighlight: color.translucify(0.8),
    border: color.lift(0.3).translucify(0.6),
  };
}

function bannerColorVariables(color: YaakColor): Partial<CSSVariables> {
  return {
    text: color.lift(0.8),
    textSubtle: color.translucify(0.3),
    textSubtlest: color.translucify(0.6),
    surface: color.translucify(0.95),
    border: color.lift(0.3).translucify(0.8),
  };
}

function buttonSolidColorVariables(
  color: YaakColor,
  isDefault: boolean = false,
): Partial<CSSVariables> {
  const theme: Partial<YaakTheme> = {
    text: new YaakColor('white', 'dark'),
    surface: color.lower(0.3),
    surfaceHighlight: color.lower(0.1),
    border: color,
  };

  if (isDefault) {
    theme.text = color.lift(0.8);
    theme.surface = undefined; // Inherit from root
    theme.surfaceHighlight = color.lift(0.08);
  }

  return theme;
}

function buttonBorderColorVariables(
  color: YaakColor,
  isDefault: boolean = false,
): Partial<CSSVariables> {
  const theme = {
    text: color.lift(0.8),
    textSubtle: color.lift(0.55),
    textSubtlest: color.lift(0.4).translucify(0.6),
    surfaceHighlight: color.translucify(0.8),
    borderSubtle: color.translucify(0.5),
    border: color.translucify(0.3),
  };

  if (isDefault) {
    theme.borderSubtle = color.lift(0.28);
    theme.border = color.lift(0.5);
  }

  return theme;
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
    .map(([name, value]) => `--${name}: ${value?.css()};`)
    .join('\n');

  return selector == null ? css : `${selector} {\n${indent(css)}\n}`;
}

function componentCSS(
  component: ComponentName,
  components?: YaakTheme['components'],
): string | null {
  if (components == null) {
    return null;
  }

  const themeVars = themeVariables(components[component]);
  return variablesToCSS(`.x-theme-${component}`, themeVars);
}

function buttonCSS(color: YaakColorKey, colors?: Partial<YaakColors>): string | null {
  const yaakColor = colors?.[color];
  if (yaakColor == null) {
    return null;
  }

  return [
    variablesToCSS(`.x-theme-button--solid--${color}`, buttonSolidColorVariables(yaakColor)),
    variablesToCSS(`.x-theme-button--border--${color}`, buttonBorderColorVariables(yaakColor)),
  ].join('\n\n');
}

function bannerCSS(color: YaakColorKey, colors?: Partial<YaakColors>): string | null {
  const yaakColor = colors?.[color];
  if (yaakColor == null) {
    return null;
  }

  return [variablesToCSS(`.x-theme-banner--${color}`, bannerColorVariables(yaakColor))].join(
    '\n\n',
  );
}

function toastCSS(color: YaakColorKey, colors?: Partial<YaakColors>): string | null {
  const yaakColor = colors?.[color];
  if (yaakColor == null) {
    return null;
  }

  return [variablesToCSS(`.x-theme-toast--${color}`, toastColorVariables(yaakColor))].join('\n\n');
}

function templateTagCSS(color: YaakColorKey, colors?: Partial<YaakColors>): string | null {
  const yaakColor = colors?.[color];
  if (yaakColor == null) {
    return null;
  }

  return [
    variablesToCSS(`.x-theme-templateTag--${color}`, templateTagColorVariables(yaakColor)),
  ].join('\n\n');
}

export function isThemeDark(theme: Partial<YaakColors>): boolean {
  if (theme.surface && theme.text) {
    return theme.text.lighterThan(theme.surface);
  }

  return false;
}

export function getThemeCSS(theme: YaakTheme): string {
  theme.components = theme.components ?? {};
  // Toast defaults to menu styles
  theme.components.toast = theme.components.toast ?? theme.components.menu ?? {};
  const { components, id, name } = theme;
  const colors = Object.keys(theme)
    .filter((key) => theme[key as YaakColorKey] instanceof YaakColor)
    .reduce((prev, key) => {
      return { ...prev, [key]: theme[key as YaakColorKey] };
    }, {});

  let themeCSS = '';
  try {
    const baseCss = variablesToCSS(null, themeVariables(theme));
    themeCSS = [
      baseCss,
      ...Object.keys(components ?? {}).map((key) =>
        componentCSS(key as ComponentName, theme.components),
      ),
      variablesToCSS(
        `.x-theme-button--solid--default`,
        buttonSolidColorVariables(theme.surface, true),
      ),
      variablesToCSS(
        `.x-theme-button--border--default`,
        buttonBorderColorVariables(theme.surface, true),
      ),
      ...Object.keys(colors ?? {}).map((key) =>
        buttonCSS(key as YaakColorKey, theme.components?.button ?? colors),
      ),
      ...Object.keys(colors ?? {}).map((key) =>
        bannerCSS(key as YaakColorKey, theme.components?.banner ?? colors),
      ),
      ...Object.keys(colors ?? {}).map((key) =>
        toastCSS(key as YaakColorKey, theme.components?.banner ?? colors),
      ),
      ...Object.keys(colors ?? {}).map((key) =>
        templateTagCSS(key as YaakColorKey, theme.components?.templateTag ?? colors),
      ),
    ].join('\n\n');
  } catch (err) {
    console.error('Failed to generate CSS', err);
  }

  return [`/* ${name} */`, `[data-theme="${id}"] {`, indent(themeCSS), '}'].join('\n');
}

export function addThemeStylesToDocument(theme: YaakTheme) {
  theme = completeTheme(theme);
  let styleEl = document.head.querySelector(`style[data-theme]`);
  if (!styleEl) {
    styleEl = document.createElement('style');
    document.head.appendChild(styleEl);
  }

  styleEl.setAttribute('data-theme', theme.id);
  styleEl.setAttribute('data-updated-at', new Date().toISOString());
  styleEl.textContent = getThemeCSS(theme);
}

export function setThemeOnDocument(theme: YaakTheme) {
  document.documentElement.setAttribute('data-theme', theme.id);
}

export function indent(text: string, space = '    '): string {
  return text
    .split('\n')
    .map((line) => space + line)
    .join('\n');
}

export function completeTheme(theme: YaakTheme): YaakTheme {
  const isDark = isThemeDark(theme);

  // Clone the theme
  theme = deserializeTheme(serializeTheme(theme), isDark ? 'dark' : 'light');

  const base = isDark ? defaultDarkTheme : defaultLightTheme;

  theme.primary = theme.primary ?? base.primary;
  theme.secondary = theme.secondary ?? base.secondary;
  theme.info = theme.info ?? base.info;
  theme.success = theme.success ?? base.success;
  theme.notice = theme.notice ?? base.notice;
  theme.warning = theme.warning ?? base.warning;
  theme.danger = theme.danger ?? base.danger;

  theme.surface = theme.surface ?? base.surface;
  theme.surfaceHighlight = theme.surfaceHighlight ?? theme.surface?.lift(0.06);
  theme.surfaceActive = theme.surfaceActive ?? theme.primary?.lower(0.2).translucify(0.8);

  theme.border = theme.border ?? theme.surface?.lift(0.12);
  theme.borderSubtle = theme.borderSubtle ?? theme.border?.lower(0.08);

  theme.text = theme.text ?? theme.border?.lift(1).lower(0.2);
  theme.textSubtle = theme.textSubtle ?? theme.text?.lower(0.3);
  theme.textSubtlest = theme.textSubtlest ?? theme.text?.lower(0.5);

  return theme;
}

export function serializeTheme(theme: YaakTheme): string {
  function next(o: Record<string, unknown>) {
    o = { ...o }; // Clone first

    for (const k of Object.keys(o)) {
      const v = o[k];
      if (v instanceof YaakColor) {
        o[k] = v.css();
      } else if (Object.prototype.toString.call(v) === '[object Object]') {
        o[k] = next(v as Record<string, unknown>);
      } else {
        o[k] = v;
      }
    }
    return o;
  }

  return JSON.stringify(next(theme));
}

export function deserializeTheme(theme: string, appearance: 'dark' | 'light'): YaakTheme {
  function next(o: Record<string, unknown>) {
    for (const k of Object.keys(o)) {
      const v = o[k];
      if (v instanceof YaakColor) {
        o[k] = v;
      } else if (typeof v === 'string' && v.match(/^(#|hsla\()/)) {
        o[k] = new YaakColor(v, appearance);
      } else if (Object.prototype.toString.call(v) === '[object Object]') {
        o[k] = next(v as Record<string, unknown>);
      } else {
        o[k] = v;
      }
    }
    return o;
  }

  return next(JSON.parse(theme)) as YaakTheme;
}
