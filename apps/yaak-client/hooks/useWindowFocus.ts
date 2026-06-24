import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useEffect, useState } from "react";
import { fireAndForget } from "../lib/fireAndForget";

export function useWindowFocus() {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const unlisten = getCurrentWebviewWindow().onFocusChanged((e) => {
      setVisible(e.payload);
    });

    return () => {
      fireAndForget(unlisten.then((fn) => fn()));
    };
  }, []);

  return visible;
}
