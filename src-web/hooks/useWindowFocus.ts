import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { useEffect, useState } from 'react';

export function useWindowFocus() {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const unlisten = getCurrentWebviewWindow().onFocusChanged((e) => {
      setVisible(e.payload);
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  return visible;
}
