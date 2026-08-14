import { platform } from "@yaakapp-internal/platform";
import { useEffect, useState } from "react";

export function useWindowFocus() {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    return platform.window.onFocusChanged(setVisible);
  }, []);

  return visible;
}
