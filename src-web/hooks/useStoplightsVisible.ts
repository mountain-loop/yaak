import { useIsFullscreen } from './useIsFullscreen';
import { useOsInfo } from './useOsInfo';

export function useStoplightsVisible() {
  const platform = useOsInfo();
  const fullscreen = useIsFullscreen();
  const stoplightsVisible = platform?.osType === 'macos' && !fullscreen;
  return stoplightsVisible;
}
