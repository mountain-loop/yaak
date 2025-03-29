import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { settingsAtom } from '@yaakapp-internal/models';
import { useAtomValue } from 'jotai';
import { useEffect } from 'react';

export function useSyncFontSizeSetting() {
  const settings = useAtomValue(settingsAtom);
  useEffect(() => {
    if (settings == null) {
      return;
    }

    const { interfaceScale, editorFontSize } = settings;
    getCurrentWebviewWindow().setZoom(interfaceScale).catch(console.error);
    document.documentElement.style.setProperty('--editor-font-size', `${editorFontSize}px`);
  }, [settings]);
}
