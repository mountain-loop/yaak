import type { Theme, ThemeComponentColors } from "@yaakapp-internal/plugins";
import { defaultDarkTheme, defaultLightTheme } from "./defaultThemes";
import { YaakColor } from "./yaakColor";

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
export type DocumentPlatform = "linux" | "macos" | "windows" | "unknown";

type ComponentName = keyof NonNullable<Theme["components"]>;
type CSSVariables = Record<YaakColorKey, string | undefined>;

export function completeFullColorVariables(theme: Theme, cmp: Partial<CSSVariables>): CSSVariables {
  const color = (value: string | undefined) => yc(theme, value);
  const vars: CSSVariables = {
    surface: cmp.surface,
    surfaceHighlight: cmp.surfaceHighlight ?? color(cmp.surface)?.lift(0.06).css(),
    surfaceActive: cmp.surfaceActive ?? color(cmp.primary)?.lower(0.2).translucify(0.8).css(),
    backdrop: cmp.backdrop ?? color(cmp.surface)?.lower(0.2).translucify(0.2).css(),
    selection: cmp.selection ?? color(cmp.primary)?.lower(0.1).translucify(0.7).css(),
    border: cmp.border,
    borderSubtle: cmp.borderSubtle,
    borderFocus: cmp.borderFocus ?? color(cmp.info)?.translucify(0.5)?.css(),
    text: cmp.text,
    textSubtle: cmp.textSubtle,
    textSubtlest: cmp.textSubtlest,
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

  const themeColor = (value: string) => new YaakColor(value, theme.dark ? "dark" : "light");
  const themeSurface = themeColor(theme.dark ? "oklch(23% 0 0)" : "oklch(100% 0 0)");
  const surface = themeColor(vars.surface ?? themeSurface.css());
  const reference = surface.compositeOver(themeSurface);
  const seed = themeColor(vars.surface ?? vars.surfaceHighlight ?? vars.border ?? surface.css());
  const textBase = seed.desaturate(0.6).opacify(1);
  const borderBase = seed.opacify(1);
  const text = vars.text ?? textBase.withContrast(reference, 11).css();
  const textColor = themeColor(text);

  return normalizeColorVariables(theme, {
    ...vars,
    text,
    textSubtle: vars.textSubtle ?? textColor.lower(0.2).css(),
    textSubtlest: vars.textSubtlest ?? textColor.lower(0.4).css(),
    border: vars.border ?? borderBase.desaturate(0.2).withContrast(reference, 3).css(),
    borderSubtle:
      vars.borderSubtle ?? borderBase.desaturate(0.2).withContrast(reference, 1.2).css(),
  });
}

export function completePartialColorVariables(
  theme: Theme,
  cmp: Partial<CSSVariables>,
): CSSVariables {
  const color = (value: string | undefined) => yc(theme, value);
  const text = color(cmp.text);

  return normalizeColorVariables(theme, {
    surface: cmp.surface,
    surfaceHighlight: cmp.surfaceHighlight ?? color(cmp.surface)?.lift(0.06).css(),
    surfaceActive: cmp.surfaceActive ?? color(cmp.primary)?.lower(0.2).translucify(0.8).css(),
    backdrop: cmp.backdrop ?? color(cmp.surface)?.lower(0.2).translucify(0.2).css(),
    selection: cmp.selection ?? color(cmp.primary)?.lower(0.1).translucify(0.7).css(),
    border: cmp.border ?? color(cmp.surface)?.lift(0.11).css(),
    borderSubtle: cmp.borderSubtle ?? color(cmp.border)?.lower(0.06).css(),
    borderFocus: cmp.borderFocus ?? color(cmp.info)?.translucify(0.5).css(),
    text: cmp.text,
    textSubtle: cmp.textSubtle ?? text?.lower(0.3).css(),
    textSubtlest: cmp.textSubtlest ?? text?.lower(0.5).css(),
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
  });
}

export const completeColorVariables = completeFullColorVariables;

function normalizeColorVariables(theme: Theme, vars: CSSVariables): CSSVariables {
  const normalized: CSSVariables = {} as CSSVariables;

  for (const [key, value] of Object.entries(vars)) {
    normalized[key as YaakColorKey] = value == null ? undefined : yc(theme, value).css();
  }

  return normalized;
}

function templateTagColorVariables(theme: Theme, color: YaakColor): CSSVariables {
  return completeFullColorVariables(theme, {
    text: color.liftMax().lower(0.05).css(),
    textSubtle: color.liftMax().lower(0.08).css(),
    textSubtlest: color.css(),
    surface: color.lower(0.2).translucify(0.8).css(),
    border: color.translucify(0.6).css(),
    borderSubtle: color.translucify(0.8).css(),
    surfaceHighlight: color.lower(0.1).translucify(0.7).css(),
  });
}

function toastColorVariables(theme: Theme, color: YaakColor): CSSVariables {
  return completeFullColorVariables(theme, {
    surface: color.translucify(0.9).css(),
    surfaceHighlight: color.translucify(0.8).css(),
  });
}

function bannerColorVariables(theme: Theme, color: YaakColor): CSSVariables {
  return completeFullColorVariables(theme, {
    text: color.desaturate(0.5).lift(0.12).css(),
    textSubtle: color.desaturate(0.58).lift(0.04).translucify(0.04).css(),
    textSubtlest: color.desaturate(0.65).translucify(0.18).css(),
    surface: color.translucify(0.95).css(),
    surfaceHighlight: color.translucify(0.85).css(),
    border: color.lift(0.3).translucify(0.8).css(),
  });
}

function buttonSolidColorVariables(
  theme: Theme,
  color: YaakColor,
  isDefault = false,
): CSSVariables {
  const vars: Partial<CSSVariables> = {
    surface: color.lower(0.3).css(),
    surfaceHighlight: color.lower(0.1).css(),
  };

  if (isDefault) {
    vars.surface = undefined;
    vars.surfaceHighlight = color.lift(0.08).css();
  }

  return completeFullColorVariables(theme, vars);
}

function buttonBorderColorVariables(
  theme: Theme,
  color: YaakColor,
  isDefault = false,
): CSSVariables {
  const vars: Partial<CSSVariables> = {
    text: color.desaturate(0.4).lift(1).css(),
    textSubtle: color.desaturate(0.4).lift(0.55).css(),
    surfaceHighlight: color.translucify(0.8).css(),
    borderSubtle: color.translucify(0.5).css(),
    border: color.translucify(0.3).css(),
  };

  if (isDefault) {
    vars.borderSubtle = color.lift(0.28).css();
    vars.border = color.lift(0.5).css();
  }

  return completeFullColorVariables(theme, vars);
}

function variablesToCSS(
  selector: string | null,
  vars: Partial<CSSVariables> | null,
): string | null {
  if (vars == null) return null;

  const css = Object.entries(vars)
    .filter(([, value]) => value)
    .map(([name, value]) => `--${name}: ${value};`)
    .join("\n");

  return selector == null ? css : `${selector} {\n${indent(css)}\n}`;
}

function componentCSS(component: ComponentName, vars: CSSVariables): string | null {
  return variablesToCSS(`.x-theme-${component}`, vars);
}

function buttonCSS(
  theme: Theme,
  colorKey: YaakColorKey,
  colors?: ThemeComponentColors,
): string | null {
  const color = yc(theme, colors?.[colorKey]);
  if (color == null) return null;

  return [
    variablesToCSS(`.x-theme-button--solid--${colorKey}`, buttonSolidColorVariables(theme, color)),
    variablesToCSS(
      `.x-theme-button--border--${colorKey}`,
      buttonBorderColorVariables(theme, color),
    ),
  ].join("\n\n");
}

function bannerCSS(
  theme: Theme,
  colorKey: YaakColorKey,
  colors?: ThemeComponentColors,
): string | null {
  const color = yc(theme, colors?.[colorKey]);
  if (color == null) return null;

  return variablesToCSS(`.x-theme-banner--${colorKey}`, bannerColorVariables(theme, color));
}

function toastCSS(
  theme: Theme,
  colorKey: YaakColorKey,
  colors?: ThemeComponentColors,
): string | null {
  const color = yc(theme, colors?.[colorKey]);
  if (color == null) return null;

  return variablesToCSS(`.x-theme-toast--${colorKey}`, toastColorVariables(theme, color));
}

function templateTagCSS(
  theme: Theme,
  colorKey: YaakColorKey,
  colors?: ThemeComponentColors,
): string | null {
  const color = yc(theme, colors?.[colorKey]);
  if (color == null) return null;

  return variablesToCSS(
    `.x-theme-templateTag--${colorKey}`,
    templateTagColorVariables(theme, color),
  );
}

export function getThemeCSS(theme: Theme): string {
  theme.components = theme.components ?? {};
  theme.components.toast = theme.components.toast ?? theme.components.menu ?? {};
  const { components, id, label } = theme;
  const colors = Object.keys(theme.base).reduce((prev, key) => {
    return { ...prev, [key]: theme.base[key as YaakColorKey] };
  }, {} as ThemeComponentColors);

  let themeCSS = "";
  try {
    const baseCss = variablesToCSS(null, completeFullColorVariables(theme, theme.base));
    const baseSurface = yc(theme, theme.base.surface);

    themeCSS = [
      baseCss,
      ...Object.entries(components).map(([key, value]) =>
        componentCSS(key as ComponentName, completePartialColorVariables(theme, value ?? {})),
      ),
      baseSurface == null
        ? null
        : variablesToCSS(
            ".x-theme-button--solid--default",
            buttonSolidColorVariables(theme, baseSurface, true),
          ),
      baseSurface == null
        ? null
        : variablesToCSS(
            ".x-theme-button--border--default",
            buttonBorderColorVariables(theme, baseSurface, true),
          ),
      ...Object.keys(colors).map((key) =>
        buttonCSS(theme, key as YaakColorKey, theme.components?.button ?? colors),
      ),
      ...Object.keys(colors).map((key) =>
        bannerCSS(theme, key as YaakColorKey, theme.components?.banner ?? colors),
      ),
      ...Object.keys(colors).map((key) =>
        toastCSS(theme, key as YaakColorKey, theme.components?.banner ?? colors),
      ),
      ...Object.keys(colors).map((key) =>
        templateTagCSS(theme, key as YaakColorKey, theme.components?.templateTag ?? colors),
      ),
    ].join("\n\n");
  } catch (err) {
    console.error("Failed to generate CSS", err);
  }

  return [`/* ${label} */`, `[data-theme="${id}"] {`, indent(themeCSS), "}"].join("\n");
}

export function addThemeStylesToDocument(rawTheme: Theme | null) {
  if (rawTheme == null) {
    console.error("Failed to add theme styles: theme is null");
    return;
  }

  const theme = completeTheme(rawTheme);
  let styleEl = document.head.querySelector("style[data-theme]");
  if (!styleEl) {
    styleEl = document.createElement("style");
    document.head.appendChild(styleEl);
  }

  styleEl.setAttribute("data-theme", theme.id);
  styleEl.setAttribute("data-updated-at", new Date().toISOString());
  styleEl.textContent = getThemeCSS(theme);
}

export function setThemeOnDocument(theme: Theme | null) {
  if (theme == null) {
    console.error("Failed to set theme: theme is null");
    return;
  }

  document.documentElement.setAttribute("data-theme", theme.id);
}

export function applyThemeToDocument(theme: Theme | null) {
  addThemeStylesToDocument(theme);
  setThemeOnDocument(theme);
}

export function platformFromUserAgent(userAgent: string): DocumentPlatform {
  const normalized = userAgent.toLowerCase();

  if (normalized.includes("linux")) return "linux";
  if (normalized.includes("mac os") || normalized.includes("macintosh")) return "macos";
  if (normalized.includes("win")) return "windows";
  return "unknown";
}

export function setPlatformOnDocument(platform: string | null | undefined) {
  const normalized =
    platform === "linux" || platform === "macos" || platform === "windows" ? platform : "unknown";
  document.documentElement.setAttribute("data-platform", normalized);
}

export function indent(text: string, space = "    "): string {
  return text
    .split("\n")
    .map((line) => space + line)
    .join("\n");
}

function yc<T extends string | null | undefined>(
  theme: Theme,
  value: T,
): T extends string ? YaakColor : null {
  if (value == null) return null as never;
  return new YaakColor(value, theme.dark ? "dark" : "light") as never;
}

export function completeTheme(theme: Theme): Theme {
  const fallback = theme.dark ? defaultDarkTheme.base : defaultLightTheme.base;

  for (const [key, value] of Object.entries(fallback)) {
    theme.base[key as YaakColorKey] ??= value;
  }

  return theme;
}
