import { type } from '@tauri-apps/plugin-os';
import { useIsFullscreen } from './useIsFullscreen';

export function useStoplightsVisible() {
  const fullscreen = useIsFullscreen();
  const stoplightsVisible = type() === 'macos' && !fullscreen;
  return stoplightsVisible;
}
