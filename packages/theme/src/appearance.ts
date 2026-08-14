import { platform } from "@yaakapp-internal/platform";

export type Appearance = "light" | "dark";

const SYSTEM_APPEARANCE_CHANGE_EVENT = "system_appearance_change";

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
  cb(getCSSAppearance());
  void getWindowAppearance().then(cb);
  return subscribeToPreferredAppearanceChange(cb);
}

export function subscribeToPreferredAppearanceChange(cb: (appearance: Appearance) => void) {
  const unsubscribeCSS = subscribeToCSSAppearanceChange(cb);
  const unsubscribeWindow = subscribeToWindowAppearanceChange(cb);
  const unsubscribeSystem = subscribeToSystemAppearanceChange(cb);
  return () => {
    unsubscribeCSS();
    unsubscribeWindow();
    unsubscribeSystem();
  };
}
