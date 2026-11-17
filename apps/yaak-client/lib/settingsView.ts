import type { LicenseCheckStatus } from "@yaakapp-internal/license";
import type { Settings } from "@yaakapp-internal/models";
import type {
  SettingsLicenseStatus,
  SettingsThemeOption,
  SettingsThemesView,
  SettingsValues,
} from "@yaakapp-internal/ui";

/** The values the shared settings tabs read, picked off the client's `Settings` model */
export function settingsValuesFromModel(settings: Settings): SettingsValues {
  return {
    appearance: settings.appearance,
    themeLight: settings.themeLight,
    themeDark: settings.themeDark,
    interfaceFont: settings.interfaceFont,
    interfaceFontSize: settings.interfaceFontSize,
    editorFont: settings.editorFont,
    editorFontSize: settings.editorFontSize,
    editorKeymap: settings.editorKeymap,
    editorSoftWrap: settings.editorSoftWrap,
    coloredMethods: settings.coloredMethods,
    useNativeTitlebar: settings.useNativeTitlebar,
    hideWindowControls: settings.hideWindowControls,
    updateChannel: settings.updateChannel,
    autoupdate: settings.autoupdate,
    autoDownloadUpdates: settings.autoDownloadUpdates,
    checkNotifications: settings.checkNotifications,
    promptFeedback: settings.promptFeedback,
  };
}

/** A license check, as the shared License tab's copy needs it */
export function licenseStatusFromCheck(
  check: LicenseCheckStatus | null | undefined,
): SettingsLicenseStatus | null {
  if (check == null) return null;
  switch (check.status) {
    case "active":
      return { status: "active" };
    case "trialing":
      return { status: "trialing", trialEnd: check.data.end };
    case "personal_use":
      return { status: "personal_use" };
    case "inactive":
      return { status: "inactive" };
    case "expired":
      return {
        status: "expired",
        periodEnd: check.data.periodEnd,
        changesUrl: check.data.changesUrl,
      };
    case "past_due":
      return { status: "past_due", billingUrl: check.data.billingUrl };
    case "error":
      return { status: "error", message: check.data.message, code: check.data.code };
  }
}

/** The fields of a theme the settings show */
interface ThemeLike {
  id: string;
  label: string;
  dark: boolean;
}

function themeOption({ id, label, dark }: ThemeLike): SettingsThemeOption {
  return { id, label, dark };
}

/** The resolved themes, as the shared Theme tab shows them; null while they load */
export function themesViewFromResolved(
  data: { themes: ThemeLike[]; light: ThemeLike; dark: ThemeLike; active: ThemeLike } | undefined,
  resolvedAppearance: "light" | "dark",
): SettingsThemesView | null {
  if (data == null) return null;
  return {
    themes: data.themes.map(themeOption),
    light: themeOption(data.light),
    dark: themeOption(data.dark),
    active: themeOption(data.active),
    resolvedAppearance,
  };
}
