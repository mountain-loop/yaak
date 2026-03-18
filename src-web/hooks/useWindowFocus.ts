import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useEffect, useState } from "react";
import { fireAndForget } from "../lib/fireAndForget";
import { isTauriRuntime } from "../lib/tauri";

export function useWindowFocus() {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }

    const unlisten = getCurrentWebviewWindow().onFocusChanged((e) => {
      setVisible(e.payload);
    });

    return () => {
      fireAndForget(unlisten.then((fn) => fn()));
    };
  }, []);

  return visible;
}
