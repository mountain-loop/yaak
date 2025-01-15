import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { useEffect } from 'react';
import { useSettings } from './useSettings';

export function useSyncFontSizeSetting() {
  const settings = useSettings();
  useEffect(() => {
    if (settings == null) {
      return;
    }

    const { interfaceScale, editorFontSize } = settings;
    getCurrentWebviewWindow().setZoom(interfaceScale).catch(console.error);
    document.documentElement.style.setProperty('--editor-font-size', `${editorFontSize}px`);
  }, [settings]);
}
