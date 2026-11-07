import { formatSize } from "@yaakapp-internal/lib/formatSize";
// The themes alone, not the package index, which reaches for the window as it loads
import { defaultDarkTheme, defaultLightTheme } from "@yaakapp-internal/theme/src/defaultThemes";
import type {
  SettingsAppInfo,
  SettingsThemeOption,
  SettingsValues,
  SettingsView,
} from "@yaakapp-internal/ui";

/** Yaak's own defaults for the shared tabs, so the two apps start the same */
export const DEFAULT_SETTINGS_VALUES: SettingsValues = {
  appearance: "system",
  themeLight: defaultLightTheme.id,
  themeDark: defaultDarkTheme.id,
  interfaceFont: null,
  interfaceFontSize: 15,
  editorFont: null,
  editorFontSize: 13,
  editorKeymap: "default",
  editorSoftWrap: true,
  coloredMethods: false,
  useNativeTitlebar: false,
  hideWindowControls: false,
  updateChannel: "stable",
  autoupdate: true,
  autoDownloadUpdates: true,
  checkNotifications: true,
  promptFeedback: true,
};

/** Where the shared tabs' values are kept in the proxy */
export const SETTINGS_VALUES_KEY = "proxy_settings_values";

/** The stored values over the defaults; anything unreadable or of the wrong type is ignored */
export function readSettingsValues(raw: string | null): SettingsValues {
  if (raw == null) return DEFAULT_SETTINGS_VALUES;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_SETTINGS_VALUES;
  }
  if (parsed == null || typeof parsed !== "object") return DEFAULT_SETTINGS_VALUES;
  const out: Record<string, unknown> = { ...DEFAULT_SETTINGS_VALUES };
  for (const [key, fallback] of Object.entries(DEFAULT_SETTINGS_VALUES)) {
    const value = (parsed as Record<string, unknown>)[key];
    const nullable = fallback === null;
    if (value === undefined) continue;
    if ((nullable && (value === null || typeof value === "string")) || typeof value === typeof fallback) {
      out[key] = value;
    }
  }
  return out as unknown as SettingsValues;
}

const THEMES: SettingsThemeOption[] = [defaultDarkTheme, defaultLightTheme].map((t) => ({
  id: t.id,
  label: t.label,
  dark: t.dark,
}));

/** The appearance showing, with `system` resolved by the OS's */
export function resolveAppearance(
  appearance: string,
  system: "light" | "dark",
): "light" | "dark" {
  return appearance === "light" || appearance === "dark" ? appearance : system;
}

/**
 * The proxy's settings as the shared tabs render them. The proxy has Yaak's two themes, no
 * installed-font list, updater or feedback prompts yet, and its license comes with the license
 * work, so those parts are left out.
 */
export function proxySettingsView(
  values: SettingsValues,
  app: SettingsAppInfo,
  systemAppearance: "light" | "dark",
): SettingsView {
  const light = THEMES.find((t) => t.id === values.themeLight && !t.dark) ?? lightOption();
  const dark = THEMES.find((t) => t.id === values.themeDark && t.dark) ?? darkOption();
  const resolvedAppearance = resolveAppearance(values.appearance, systemAppearance);
  return {
    app,
    values,
    themes: {
      themes: THEMES,
      light,
      dark,
      active: resolvedAppearance === "dark" ? dark : light,
      resolvedAppearance,
    },
    fonts: null,
    windowControlsSetting: false,
    updates: null,
    feedbackPrompts: false,
    license: null,
  };
}

function lightOption(): SettingsThemeOption {
  return THEMES.find((t) => !t.dark) as SettingsThemeOption;
}

function darkOption(): SettingsThemeOption {
  return THEMES.find((t) => t.dark) as SettingsThemeOption;
}

/** A size choice in a select, `null` for no limit */
export interface SizeOption {
  label: string;
  value: string;
  bytes: number | null;
}

const MB = 1024 * 1024;
const GB = 1024 * MB;

function sizeOptions(sizes: (number | null)[], none: string): SizeOption[] {
  return sizes.map((bytes) => ({
    label: bytes == null ? none : sizeLabel(bytes),
    value: bytes == null ? "none" : `${bytes}`,
    bytes,
  }));
}

/** A size in the binary units the limits are set in, so 10 MiB reads "10 MB", not "10.5 MB" */
export function sizeLabel(bytes: number): string {
  if (bytes >= GB && bytes % (GB / 2) === 0) return `${bytes / GB} GB`;
  if (bytes >= MB && bytes % MB === 0) return `${bytes / MB} MB`;
  return formatSize(bytes);
}

/** How much captured traffic is kept before the oldest flows are dropped */
export const KEEP_TRAFFIC_OPTIONS = sizeOptions([null, 500 * MB, GB, 2 * GB, 5 * GB, 10 * GB, 20 * GB], "Unlimited");

/** How much of each body is stored */
export const CAPTURE_LIMIT_OPTIONS = sizeOptions([MB, 5 * MB, 10 * MB, 50 * MB, 100 * MB], "Unlimited");

/**
 * The option a stored size selects. A size set elsewhere (the CLI or `settings.json`) that no
 * option has is added as its own, so the select still shows it.
 */
export function sizeOptionsFor(options: SizeOption[], bytes: number | null): SizeOption[] {
  if (options.some((o) => o.bytes === bytes)) return options;
  const extra = sizeOptions([bytes], "Unlimited");
  return [...options, ...extra].sort((a, b) => (a.bytes ?? Infinity) - (b.bytes ?? Infinity));
}

export function sizeOptionValue(bytes: number | null): string {
  return bytes == null ? "none" : `${bytes}`;
}

export function sizeFromOptionValue(value: string): number | null {
  if (value === "none") return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}
