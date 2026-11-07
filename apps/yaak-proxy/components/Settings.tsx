import { useQuery } from "@tanstack/react-query";
import { getVersion } from "@tauri-apps/api/app";
import { appDataDir, appLogDir } from "@tauri-apps/api/path";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
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
} from "@yaakapp-internal/ui";
import { atom, useAtom, useSetAtom } from "jotai";
import { useEffect, useMemo, useState } from "react";
import { settingsValuesAtom } from "../lib/interfaceSettings";
import { proxySettingsView } from "../lib/settings";
import { getOsType } from "../lib/tauri";
import { SettingsProxy } from "./SettingsProxy";

export const SETTINGS_TAB_PROXY = "proxy";

/** The settings window is open, on a tab, or closed */
export const settingsOpenAtom = atom<string | null>(null);

/**
 * Yaak's settings, shared: its General, Theme, Interface and License tabs, plus the proxy's own
 * Proxy tab. The header's gear and `⌘,` open it.
 */
export function SettingsWindow() {
  const [tab, setTab] = useAtom(settingsOpenAtom);
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

/** The settings themselves, as the window holds them */
export function SettingsContent({ defaultTab }: { defaultTab: string }) {
  const [values, change] = useAtom(settingsValuesAtom);
  const app = useAppInfo();
  const systemAppearance = useSystemAppearance();
  const view = useMemo(
    () => proxySettingsView(values, app, systemAppearance),
    [values, app, systemAppearance],
  );
  const callbacks = useMemo<SettingsCallbacks>(
    () => ({
      onChange: (patch) => change(patch),
      // The proxy draws its own title bar always; the row isn't shown
      onApplyNativeTitlebar: (useNativeTitlebar) => change({ useNativeTitlebar }),
      onCheckForUpdates: () => undefined,
      onActivateLicense: async () => undefined,
      onDeactivateLicense: () => undefined,
      onOpenUrl: (url) => void openUrl(url).catch(console.error),
      onRevealPath: (path) => void revealItemInDir(path).catch(console.error),
      pricingUrl: (intent) => `https://yaak.app/pricing?intent=${encodeURIComponent(intent)}`,
    }),
    [change],
  );
  const props = { view, callbacks };

  return (
    <SettingsDialog
      titlebar={null}
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

/** `⌘,`, or `Ctrl+,` off macOS, opens settings, as in Yaak */
function useSettingsHotkey() {
  const setOpen = useSetAtom(settingsOpenAtom);
  useEffect(() => {
    const mac = getOsType() === "macos";
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "," || e.shiftKey || e.altKey) return;
      if (mac ? !e.metaKey || e.ctrlKey : !e.ctrlKey || e.metaKey) return;
      e.preventDefault();
      setOpen((tab) => tab ?? SETTINGS_TAB_GENERAL);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [setOpen]);
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

/** Opens settings on a tab */
export function useOpenSettings() {
  const setOpen = useSetAtom(settingsOpenAtom);
  return (tab: string = SETTINGS_TAB_GENERAL) => setOpen(tab);
}
