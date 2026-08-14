import { platform } from "@yaakapp-internal/platform";

export function setWindowTitle(title: string) {
  platform.rpc("plugin:yaak-mac-window|set_title", { title }).catch(console.error);
}

export function setWindowTheme(bgColor: string) {
  platform.rpc("plugin:yaak-mac-window|set_theme", { bgColor }).catch(console.error);
}
