import { platform } from "@yaakapp-internal/platform";
import { useLicense } from "@yaakapp-internal/license";
import { pluginsAtom, settingsAtom } from "@yaakapp-internal/models";
import {
  CountBadge,
  SETTINGS_TAB_GENERAL,
  SETTINGS_TAB_INTERFACE,
  SETTINGS_TAB_LICENSE,
  SETTINGS_TAB_THEME,
  SettingsDialog,
  type SettingsTabDef,
} from "@yaakapp-internal/ui";
import { useAtomValue } from "jotai";
import { useKeyPressEvent } from "react-use";
import { appInfo } from "../../lib/appInfo";
import { capitalize } from "../../lib/capitalize";
import { SettingsAgents } from "./SettingsAgents";
import { SettingsCertificates } from "./SettingsCertificates";
import { SettingsGeneral } from "./SettingsGeneral";
import { SettingsHotkeys } from "./SettingsHotkeys";
import { SettingsInterface } from "./SettingsInterface";
import { SettingsLicense } from "./SettingsLicense";
import { SettingsPlugins } from "./SettingsPlugins";
import { SettingsProxy } from "./SettingsProxy";
import { SettingsTheme } from "./SettingsTheme";

interface Props {
  tab?: SettingsTabWithSubtab | null;
  /** Set when Settings is in a dialog rather than owning a window. */
  hide?: () => void;
}

const TAB_GENERAL = SETTINGS_TAB_GENERAL;
const TAB_INTERFACE = SETTINGS_TAB_INTERFACE;
const TAB_THEME = SETTINGS_TAB_THEME;
const TAB_SHORTCUTS = "shortcuts";
const TAB_PROXY = "proxy";
const TAB_CERTIFICATES = "certificates";
const TAB_PLUGINS = "plugins";
const TAB_AGENTS = "agents";
const TAB_LICENSE = SETTINGS_TAB_LICENSE;
const tabs = [
  TAB_GENERAL,
  TAB_THEME,
  TAB_INTERFACE,
  TAB_SHORTCUTS,
  TAB_PLUGINS,
  TAB_AGENTS,
  TAB_CERTIFICATES,
  TAB_PROXY,
  TAB_LICENSE,
] as const;
export type SettingsTab = (typeof tabs)[number];
export type SettingsTabWithSubtab = SettingsTab | `${SettingsTab}:${string}`;

export default function Settings({ tab, hide }: Props) {
  // Parse tab and subtab (e.g., "plugins:installed")
  const [mainTab, subtab] = tab?.split(":") ?? [];
  const settings = useAtomValue(settingsAtom);
  const plugins = useAtomValue(pluginsAtom);
  const licenseCheck = useLicense();

  // Close settings window on escape. In a dialog, the dialog handles Escape itself.
  // TODO: Could this be put in a better place? Eg. in Rust key listener when creating the window
  useKeyPressEvent("Escape", async () => {
    if (hide == null) await platform.window.close();
  });

  const tabDefs: Record<SettingsTab, Omit<SettingsTabDef, "value" | "label">> = {
    [TAB_GENERAL]: { icon: "settings", content: <SettingsGeneral /> },
    [TAB_THEME]: { icon: "palette", content: <SettingsTheme /> },
    [TAB_INTERFACE]: { icon: "columns_2", content: <SettingsInterface /> },
    [TAB_SHORTCUTS]: { icon: "keyboard", content: <SettingsHotkeys /> },
    [TAB_PLUGINS]: {
      icon: "puzzle",
      rightSlot: <CountBadge count={plugins.filter((p) => p.source !== "bundled").length} />,
      content: <SettingsPlugins defaultSubtab={mainTab === TAB_PLUGINS ? subtab : undefined} />,
      contentClassName: "h-full grid grid-rows-1",
    },
    [TAB_AGENTS]: {
      icon: "sparkles",
      hidden: !platform.capabilities.agents,
      content: <SettingsAgents />,
    },
    [TAB_CERTIFICATES]: {
      icon: "shield_check",
      rightSlot: <CountBadge count={settings.clientCertificates.length} />,
      content: <SettingsCertificates />,
    },
    [TAB_PROXY]: {
      icon: "wifi",
      rightSlot: settings.proxy?.type === "enabled" ? <CountBadge count /> : null,
      content: <SettingsProxy />,
    },
    [TAB_LICENSE]: {
      icon: "key_round",
      hidden: !appInfo.featureLicense,
      rightSlot:
        licenseCheck.check.data?.status === "personal_use" ? (
          <CountBadge count color="notice" />
        ) : null,
      content: <SettingsLicense />,
    },
  };

  return (
    <SettingsDialog
      defaultTab={mainTab}
      titlebar={
        hide
          ? null
          : {
              osType: platform.osType(),
              hideWindowControls: settings.hideWindowControls,
              useNativeTitlebar: settings.useNativeTitlebar,
              interfaceScale: settings.interfaceScale,
            }
      }
      tabs={tabs.map((value) => ({ value, label: capitalize(value), ...tabDefs[value] }))}
    />
  );
}
