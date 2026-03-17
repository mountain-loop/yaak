import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { fireAndForget } from "../fireAndForget";
import { isTauriRuntime } from "../tauri";

export type Appearance = "light" | "dark";

export function getCSSAppearance(): Appearance {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export async function getWindowAppearance(): Promise<Appearance> {
  if (!isTauriRuntime()) {
    return getCSSAppearance();
  }

  try {
    const a = await getCurrentWebviewWindow().theme();
    return a ?? getCSSAppearance();
  } catch {
    return getCSSAppearance();
  }
}

/**
 * Subscribe to appearance (dark/light) changes. Note, we use Tauri Window appearance instead of
 * CSS appearance because CSS won't fire the way we handle window theme management.
 */
export function subscribeToWindowAppearanceChange(
  cb: (appearance: Appearance) => void,
): () => void {
  if (!isTauriRuntime()) {
    return () => {};
  }

  const container = {
    unsubscribe: () => {},
  };

  try {
    fireAndForget(
      getCurrentWebviewWindow()
        .onThemeChanged((t) => {
          cb(t.payload);
        })
        .then((l) => {
          container.unsubscribe = l;
        }),
    );
  } catch {
    // Non-Tauri context
  }

  return () => container.unsubscribe();
}

export function resolveAppearance(
  preferredAppearance: Appearance,
  appearanceSetting: string,
): Appearance {
  const appearance = appearanceSetting === "system" ? preferredAppearance : appearanceSetting;
  return appearance === "dark" ? "dark" : "light";
}

export function subscribeToPreferredAppearance(cb: (a: Appearance) => void) {
  cb(getCSSAppearance());
  fireAndForget(getWindowAppearance().then(cb));
  subscribeToWindowAppearanceChange(cb);
}
