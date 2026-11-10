/**
 * What the shared settings tabs render and change. Each app maps its own settings store onto
 * these (the client its `Settings` model, the proxy its own), so the tabs never import either
 * app's models.
 */

export type SettingsEditorKeymap = "default" | "vim" | "vscode" | "emacs";

/** The values the shared tabs read and change, named as Yaak's settings name them */
export interface SettingsValues {
  /** `system`, `light` or `dark` */
  appearance: string;
  themeLight: string;
  themeDark: string;
  interfaceFont: string | null;
  interfaceFontSize: number;
  editorFont: string | null;
  editorFontSize: number;
  editorKeymap: SettingsEditorKeymap;
  editorSoftWrap: boolean;
  coloredMethods: boolean;
  useNativeTitlebar: boolean;
  hideWindowControls: boolean;
  /** `stable` or `beta` */
  updateChannel: string;
  autoupdate: boolean;
  autoDownloadUpdates: boolean;
  checkNotifications: boolean;
  promptFeedback: boolean;
}

/** A change to some of the values, as a tab makes it */
export type SettingsPatch = Partial<SettingsValues>;

/** The app the settings belong to, for its name in the copy and its paths */
export interface SettingsAppInfo {
  /** As the copy says it: `Yaak`, `Yaak Proxy` */
  name: string;
  version: string;
  dataDir: string;
  logDir: string;
  /** The label for showing a path in the file manager, like `Reveal in Finder` */
  revealPathLabel: string;
}

export interface SettingsThemeOption {
  id: string;
  label: string;
  dark: boolean;
}

export interface SettingsThemesView {
  /** Every installed theme, light and dark */
  themes: SettingsThemeOption[];
  /** The light and dark themes in use, after falling back from a missing one */
  light: SettingsThemeOption;
  dark: SettingsThemeOption;
  /** The theme showing now */
  active: SettingsThemeOption;
  /** The appearance showing now, with `system` resolved */
  resolvedAppearance: "light" | "dark";
}

export interface SettingsFontsView {
  uiFonts: string[];
  editorFonts: string[];
}

export interface SettingsUpdatesView {
  /** A check for updates is running */
  checking: boolean;
}

/** Where a license stands, with what each state's copy needs */
export type SettingsLicenseStatus =
  | { status: "active" }
  | { status: "trialing"; trialEnd: string }
  | { status: "personal_use" }
  | { status: "inactive" }
  | { status: "expired"; periodEnd: string; changesUrl: string | null }
  | { status: "past_due"; billingUrl: string }
  | { status: "error"; message: string; code: string };

export interface SettingsLicenseView {
  /** The first check hasn't returned yet */
  pending: boolean;
  /** Null when the check returned nothing */
  status: SettingsLicenseStatus | null;
  checkError: string | null;
  activateError: string | null;
  activating: boolean;
}

export interface SettingsView {
  app: SettingsAppInfo;
  values: SettingsValues;
  /** Null while the themes load */
  themes: SettingsThemesView | null;
  /** Null while the installed fonts load */
  fonts: SettingsFontsView | null;
  /** Show the row that hides the window controls, which only Windows and Linux draw */
  windowControlsSetting: boolean;
  /** Null when this build has no updater */
  updates: SettingsUpdatesView | null;
  /** Show the row that turns feedback prompts off */
  feedbackPrompts: boolean;
  /** Null when this build has no license */
  license: SettingsLicenseView | null;
  /** Interface rows this app doesn't act on yet, left out of the tab */
  hiddenInterfaceRows?: SettingsInterfaceRow[];
}

/** The Interface tab's rows an app may leave out */
export type SettingsInterfaceRow =
  | "editorKeymap"
  | "editorSoftWrap"
  | "coloredMethods"
  | "nativeTitlebar";

export interface SettingsCallbacks {
  onChange: (patch: SettingsPatch) => void | Promise<void>;
  /** Save the native title bar choice and restart, since it only applies at launch */
  onApplyNativeTitlebar: (useNativeTitlebar: boolean) => void | Promise<void>;
  onCheckForUpdates: () => void;
  onActivateLicense: (licenseKey: string) => Promise<void>;
  onDeactivateLicense: () => void;
  /** Open a link outside the app */
  onOpenUrl: (url: string) => void;
  /** Show a file or folder in the file manager */
  onRevealPath: (path: string) => void;
  /** Where to buy a license, tagged with where the click came from */
  pricingUrl: (intent: string) => string;
}
