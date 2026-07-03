import { listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

export type Appearance = "light" | "dark";

const SYSTEM_APPEARANCE_CHANGE_EVENT = "system_appearance_change";

export function getCSSAppearance(): Appearance {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export async function getWindowAppearance(): Promise<Appearance> {
  const appearance = await getCurrentWebviewWindow().theme();
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
  const container = {
    unsubscribe: () => {},
  };

  void getCurrentWebviewWindow()
    .onThemeChanged((theme) => {
      cb(theme.payload);
    })
    .then((listener) => {
      container.unsubscribe = listener;
    });

  return () => container.unsubscribe();
}

export function subscribeToSystemAppearanceChange(
  cb: (appearance: Appearance) => void,
): () => void {
  const container = {
    unsubscribe: () => {},
  };

  void listen<Appearance>(SYSTEM_APPEARANCE_CHANGE_EVENT, (event) => {
    cb(event.payload);
  }).then((listener) => {
    container.unsubscribe = listener;
  });

  return () => container.unsubscribe();
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
