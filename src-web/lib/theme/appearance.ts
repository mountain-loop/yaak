import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { platform } from '@tauri-apps/plugin-os';
import { getSettings } from '../settings';
import { getResolvedTheme } from './themes';
import { addThemeStylesToDocument, setThemeOnDocument } from './window';

export type Appearance = 'light' | 'dark';

export function getCSSAppearance(): Appearance {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export async function getWindowAppearance(): Promise<Appearance> {
  const currentPlatform = await platform();
  if (currentPlatform === 'linux') {
    try {
      const theme = await invoke<string>('get_linux_theme');
      // Start watching for theme changes on Linux
      await invoke('watch_linux_theme');
      return theme === 'dark' ? 'dark' : 'light';
    } catch (error) {
      console.error('Failed to get Linux theme:', error);
    }
  }
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

// Listen for theme changes from Linux
listen('theme-changed', (event) => {
  const theme = event.payload as string;
  
  getSettings().then(settings => {
    const resolvedTheme = getResolvedTheme(
      theme as Appearance,
      'system', // Use system setting since this is a system theme change
      settings.themeLight,
      settings.themeDark
    );
    
    addThemeStylesToDocument(resolvedTheme.active);
    setThemeOnDocument(resolvedTheme.active);
  }).catch(error => {
    console.error('Failed to get settings:', error);
    // Fallback to basic theme if settings fail
    document.documentElement.setAttribute('data-theme', theme);
  });
});
