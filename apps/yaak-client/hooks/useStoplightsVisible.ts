import { type } from '@tauri-apps/plugin-os';
import { useIsFullscreen } from '@yaakapp-internal/ui';

export function useStoplightsVisible() {
  const fullscreen = useIsFullscreen();
  const stoplightsVisible = type() === 'macos' && !fullscreen;
  return stoplightsVisible;
}
