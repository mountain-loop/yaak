import { platform } from "@yaakapp-internal/platform";

export type Appearance = "light" | "dark";

const SYSTEM_APPEARANCE_CHANGE_EVENT = "system_appearance_change";

declare global {
  interface Window {
    __YAAK_INITIAL_APPEARANCE__?: Appearance;
  }
}

// NOTE: On macOS and Linux the backend detects the appearance the OS prefers and injects
//  it here, later emitting change events. This is required because applying a theme forces
//  the window appearance, which poisons what the webview reports (CSS media queries and
//  window theme events follow the override).
export function getSystemAppearance(): Appearance | null {
  const appearance = window.__YAAK_INITIAL_APPEARANCE__;
  return appearance === "dark" || appearance === "light" ? appearance : null;
}

export function getCSSAppearance(): Appearance {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export async function getWindowAppearance(): Promise<Appearance> {
  const appearance = await platform.window.theme();
  return appearance ?? getCSSAppearance();
}

export function subscribeToCSSAppearanceChange(cb: (appearance: Appearance) => void): () => void {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const listener = () => cb(media.matches ? "dark" : "light");
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
}

export function subscribeToWindowAppearanceChange(
  cb: (appearance: Appearance) => void,
): () => void {
  return platform.window.onThemeChanged(cb);
}

export function subscribeToSystemAppearanceChange(
  cb: (appearance: Appearance) => void,
): () => void {
  return platform.listen<Appearance>(SYSTEM_APPEARANCE_CHANGE_EVENT, cb);
}

export function resolveAppearance(
  preferredAppearance: Appearance,
  appearanceSetting: string,
): Appearance {
  const appearance = appearanceSetting === "system" ? preferredAppearance : appearanceSetting;
  return appearance === "dark" ? "dark" : "light";
}

export function subscribeToPreferredAppearance(cb: (appearance: Appearance) => void) {
  const systemAppearance = getSystemAppearance();
  if (systemAppearance != null) {
    cb(systemAppearance);
    return subscribeToSystemAppearanceChange(cb);
  }

  cb(getCSSAppearance());
  void getWindowAppearance().then(cb);
  return subscribeToPreferredAppearanceChange(cb);
}

export function subscribeToPreferredAppearanceChange(cb: (appearance: Appearance) => void) {
  if (getSystemAppearance() != null) {
    // The CSS and window sources are poisoned by forced window appearances, so only
    // listen to the backend's system appearance detection when it's available
    return subscribeToSystemAppearanceChange(cb);
  }

  const unsubscribeCSS = subscribeToCSSAppearanceChange(cb);
  const unsubscribeWindow = subscribeToWindowAppearanceChange(cb);
  const unsubscribeSystem = subscribeToSystemAppearanceChange(cb);
  return () => {
    unsubscribeCSS();
    unsubscribeWindow();
    unsubscribeSystem();
  };
}
