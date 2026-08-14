import { platform } from "@yaakapp-internal/platform";
import { settingsAtom } from "@yaakapp-internal/models";
import { useAtomValue } from "jotai";
import { useEffect } from "react";

export function useSyncFontSizeSetting() {
  const settings = useAtomValue(settingsAtom);
  useEffect(() => {
    if (settings == null) {
      return;
    }

    const { interfaceScale, editorFontSize } = settings;
    platform.window.setZoom(interfaceScale).catch(console.error);
    document.documentElement.style.setProperty("--editor-font-size", `${editorFontSize}px`);
  }, [settings]);
}
