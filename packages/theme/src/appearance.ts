import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

export type Appearance = "light" | "dark";

export function getCSSAppearance(): Appearance {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export async function getWindowAppearance(): Promise<Appearance> {
  const appearance = await getCurrentWebviewWindow().theme();
  return appearance ?? getCSSAppearance();
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
  subscribeToWindowAppearanceChange(cb);
}
