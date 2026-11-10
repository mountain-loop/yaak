import { useFonts } from "@yaakapp-internal/fonts";
import { useLicense } from "@yaakapp-internal/license";
import { patchModel, settingsAtom } from "@yaakapp-internal/models";
import { platform } from "@yaakapp-internal/platform";
import type { SettingsCallbacks, SettingsView } from "@yaakapp-internal/ui";
import { useAtomValue } from "jotai";
import { openExternalUrl } from "../components/core/Link";
import { appInfo } from "../lib/appInfo";
import { pricingUrl } from "../lib/pricingUrl";
import { revealInFinderText } from "../lib/reveal";
import { rpc } from "../lib/rpc";
import {
  licenseStatusFromCheck,
  settingsValuesFromModel,
  themesViewFromResolved,
} from "../lib/settingsView";
import { useCheckForUpdates } from "./useCheckForUpdates";
import { useResolvedAppearance } from "./useResolvedAppearance";
import { useResolvedTheme } from "./useResolvedTheme";

/** Binds the shared settings tabs to the client's settings model, themes, fonts and license */
export function useSettingsView(): { view: SettingsView; callbacks: SettingsCallbacks } | null {
  const settings = useAtomValue(settingsAtom);
  const appearance = useResolvedAppearance();
  const activeTheme = useResolvedTheme();
  const fonts = useFonts();
  const { check, activate, deactivate } = useLicense();
  const checkForUpdates = useCheckForUpdates();

  if (settings == null) {
    return null;
  }

  const view: SettingsView = {
    app: {
      name: "Yaak",
      version: appInfo.version,
      dataDir: appInfo.appDataDir,
      logDir: appInfo.appLogDir,
      revealPathLabel: revealInFinderText,
    },
    values: settingsValuesFromModel(settings),
    themes: themesViewFromResolved(activeTheme.data, appearance),
    fonts: fonts.data ?? null,
    windowControlsSetting: platform.osType() !== "macos",
    updates: appInfo.featureUpdater ? { checking: checkForUpdates.isPending } : null,
    feedbackPrompts: appInfo.featureLicense,
    license: appInfo.featureLicense
      ? {
          pending: check.isPending,
          status: licenseStatusFromCheck(check.data),
          checkError: check.error ?? null,
          activateError: activate.error ?? null,
          activating: activate.isPending,
        }
      : null,
  };

  const callbacks: SettingsCallbacks = {
    onChange: async (patch) => {
      await patchModel(settings, patch);
    },
    onApplyNativeTitlebar: async (useNativeTitlebar) => {
      await patchModel(settings, { useNativeTitlebar });
      await rpc("cmd_restart");
    },
    onCheckForUpdates: () => checkForUpdates.mutate(),
    onActivateLicense: (licenseKey) => activate.mutateAsync({ licenseKey }),
    onDeactivateLicense: () => deactivate.mutate(),
    onOpenUrl: openExternalUrl,
    onRevealPath: (path) => platform.revealItemInDir(path),
    pricingUrl,
  };

  return { view, callbacks };
}
