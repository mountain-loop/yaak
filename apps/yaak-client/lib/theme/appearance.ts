import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';

export type Appearance = 'light' | 'dark';

export function getCSSAppearance(): Appearance {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export async function getWindowAppearance(): Promise<Appearance> {
  const a = await getCurrentWebviewWindow().theme();
  return a ?? getCSSAppearance();
}

/**
 * Subscribe to appearance (dark/light) changes. Note, we use Tauri Window appearance instead of
 * CSS appearance because CSS won't fire the way we handle window theme management.
 */
export function subscribeToWindowAppearanceChange(
  cb: (appearance: Appearance) => void,
): () => void {
  const container = {
    unsubscribe: () => {},
  };

  getCurrentWebviewWindow()
    .onThemeChanged((t) => {
      cb(t.payload);
    })
    .then((l) => {
      container.unsubscribe = l;
    });

  return () => container.unsubscribe();
}

export function resolveAppearance(
  preferredAppearance: Appearance,
  appearanceSetting: string,
): Appearance {
  const appearance = appearanceSetting === 'system' ? preferredAppearance : appearanceSetting;
  return appearance === 'dark' ? 'dark' : 'light';
}

export function subscribeToPreferredAppearance(cb: (a: Appearance) => void) {
  cb(getCSSAppearance());
  getWindowAppearance().then(cb);
  subscribeToWindowAppearanceChange(cb);
}
