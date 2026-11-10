import { useQuery } from "@tanstack/react-query";
import { getVersion } from "@tauri-apps/api/app";
import { appDataDir, appLogDir } from "@tauri-apps/api/path";
import {
  Dialog,
  EmptyStateText,
  SETTINGS_TAB_GENERAL,
  SETTINGS_TAB_INTERFACE,
  SETTINGS_TAB_LICENSE,
  SETTINGS_TAB_THEME,
  type SettingsCallbacks,
  SettingsDialog,
  SettingsGeneral,
  SettingsInterface,
  SettingsTheme,
  type SettingsTitlebar,
  Toasts,
} from "@yaakapp-internal/ui";
import { atom, useAtom, useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect, useMemo, useState } from "react";
import { settingsValuesAtom } from "../lib/interfaceSettings";
import { openLink, revealPath } from "../lib/opener";
import { proxySettingsView } from "../lib/settings";
import { closeWindow, command, currentWindowLabel, getOsType, subscribe } from "../lib/tauri";
import { useShowToast } from "../lib/toast";
import {
  openSettingsVia,
  requestedSettingsTab,
  SETTINGS_TAB_EVENT,
  windowKind,
} from "../lib/windows";
import { HelperDialog } from "./HelperDialog";
import { useProxySetup } from "./ProxyStatus";
import { SettingsProxy } from "./SettingsProxy";

export const SETTINGS_TAB_PROXY = "proxy";

/** The settings dialog is open, on a tab, or closed, where Settings has no window of its own */
const settingsDialogAtom = atom<string | null>(null);

/**
 * Yaak's settings, shared: its General, Theme, Interface and License tabs, plus the proxy's own
 * Proxy tab. The header's gear and `⌘,` open it in a window of its own, or, where the app has
 * no second window to give, such as the browser harness, in this dialog.
 */
export function SettingsDialogFallback() {
  const [tab, setTab] = useAtom(settingsDialogAtom);
  useSettingsHotkey();
  return (
    <Dialog
      open={tab != null}
      onClose={() => setTab(null)}
      size="lg"
      noPadding
      noScroll
      className="h-[min(44rem,90vh)]"
    >
      {tab != null && <SettingsContent defaultTab={tab} />}
    </Dialog>
  );
}

/**
 * The Settings window: the settings alone, full-window under their own title bar, on the tab
 * asked for, moving to another tab each time Settings is opened on one. Escape closes it. The
 * dialogs the settings open, and their toasts, show over it.
 */
export function SettingsWindowContent() {
  const [shown, setShown] = useState(() => ({
    tab: requestedSettingsTab() ?? SETTINGS_TAB_GENERAL,
    // Keys the tabs, which take their tab only as they mount
    version: 0,
  }));
  useEffect(
    () =>
      subscribe<string>(SETTINGS_TAB_EVENT, (tab) =>
        setShown((s) => ({ tab, version: s.version + 1 })),
      ),
    [],
  );
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // A dialog over the settings takes its own Escape and stops it here, an editor's popup
      // marks it handled, and an open menu closes on it, leaving the window open
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (document.querySelector('[role="menu"]') != null) return;
      closeWindow().catch(console.error);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
  // Reads the system proxy and certificate as the main window's header does, polling while the
  // helper awaits approval, so the helper's dialog here sees it given.
  useProxySetup();
  const { hideWindowControls } = useAtomValue(settingsValuesAtom);
  const titlebar = useMemo<SettingsTitlebar>(
    () => ({
      osType: getOsType(),
      hideWindowControls,
      // The proxy draws its own title bar always, as its main window does
      useNativeTitlebar: false,
      interfaceScale: 1,
    }),
    [hideWindowControls],
  );

  return (
    <div className="h-full w-full bg-surface">
      <SettingsContent key={shown.version} defaultTab={shown.tab} titlebar={titlebar} />
      <HelperDialog />
      <Toasts />
    </div>
  );
}

/** The settings themselves, as the window or the dialog holds them */
export function SettingsContent({
  defaultTab,
  titlebar = null,
}: {
  defaultTab: string;
  /** The window's title bar; none in the dialog, which has its own frame */
  titlebar?: SettingsTitlebar | null;
}) {
  const [values, change] = useAtom(settingsValuesAtom);
  const app = useAppInfo();
  const systemAppearance = useSystemAppearance();
  const view = useMemo(
    () => proxySettingsView(values, app, systemAppearance),
    [values, app, systemAppearance],
  );
  const showToast = useShowToast();
  const callbacks = useMemo<SettingsCallbacks>(() => {
    const fail = (message: string) => showToast({ message, color: "danger" });
    return {
      onChange: (patch) => change(patch),
      // The proxy draws its own title bar always; the row isn't shown
      onApplyNativeTitlebar: (useNativeTitlebar) => change({ useNativeTitlebar }),
      onCheckForUpdates: () => undefined,
      onActivateLicense: async () => undefined,
      onDeactivateLicense: () => undefined,
      onOpenUrl: (url) => void openLink(url, fail),
      onRevealPath: (path) => void revealPath(path, fail),
      pricingUrl: (intent) => `https://yaak.app/pricing?intent=${encodeURIComponent(intent)}`,
    };
  }, [change, showToast]);
  const props = { view, callbacks };

  return (
    <SettingsDialog
      titlebar={titlebar}
      defaultTab={defaultTab}
      tabs={[
        {
          value: SETTINGS_TAB_GENERAL,
          label: "General",
          icon: "settings",
          content: <SettingsGeneral {...props} />,
        },
        {
          value: SETTINGS_TAB_THEME,
          label: "Theme",
          icon: "palette",
          content: <SettingsTheme {...props} />,
        },
        {
          value: SETTINGS_TAB_INTERFACE,
          label: "Interface",
          icon: "columns_2",
          content: <SettingsInterface {...props} />,
        },
        {
          value: SETTINGS_TAB_PROXY,
          label: "Proxy",
          icon: "wifi",
          content: <SettingsProxy />,
        },
        {
          value: SETTINGS_TAB_LICENSE,
          label: "License",
          icon: "key_round",
          content: <EmptyStateText>Coming soon</EmptyStateText>,
        },
      ]}
    />
  );
}

/** `⌘,`, or `Ctrl+,` off macOS, opens settings, as in Yaak, on the tab they were left on */
function useSettingsHotkey() {
  const open = useOpenSettings();
  useEffect(() => {
    const mac = getOsType() === "macos";
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "," || e.shiftKey || e.altKey) return;
      if (mac ? !e.metaKey || e.ctrlKey : !e.ctrlKey || e.metaKey) return;
      e.preventDefault();
      open(null);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);
}

function useAppInfo() {
  const os = getOsType();
  const { data } = useQuery({
    queryKey: ["settings_app_info"],
    queryFn: async () => {
      const [version, dataDir, logDir] = await Promise.all([
        getVersion(),
        appDataDir(),
        appLogDir(),
      ]);
      return { version, dataDir, logDir };
    },
    retry: false,
  });
  return useMemo(
    () => ({
      name: "Yaak Proxy",
      version: data?.version ?? "",
      dataDir: data?.dataDir ?? "",
      logDir: data?.logDir ?? "",
      revealPathLabel:
        os === "macos"
          ? "Reveal in Finder"
          : os === "windows"
            ? "Show in Explorer"
            : "Show in Folder",
    }),
    [data, os],
  );
}

function useSystemAppearance(): "light" | "dark" {
  const query = "(prefers-color-scheme: dark)";
  const [dark, setDark] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const onChange = () => setDark(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  return dark ? "dark" : "light";
}

/**
 * Opens settings on a tab, General unless another is given. With `null`, opens it on General,
 * or brings it forward on the tab it is on.
 */
export function useOpenSettings() {
  const setDialog = useSetAtom(settingsDialogAtom);
  const showToast = useShowToast();
  return useCallback(
    (tab: string | null = SETTINGS_TAB_GENERAL) => {
      openSettingsVia(tab, {
        kind: windowKind(currentWindowLabel()),
        openWindow: (tab) => command<void>("cmd_open_settings", { tab }),
        openDialog: (tab) => setDialog((open) => tab ?? open ?? SETTINGS_TAB_GENERAL),
      }).catch((err) => showToast({ id: "open-settings", color: "danger", message: String(err) }));
    },
    [setDialog, showToast],
  );
}
