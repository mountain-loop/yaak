import { useQuery } from '@tanstack/react-query';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { useWindowSize } from 'react-use';
import { useDebouncedValue } from './useDebouncedValue';

export function useIsFullscreen() {
  const windowSize = useWindowSize();
  const debouncedWindowWidth = useDebouncedValue(windowSize.width);

  // NOTE: Fullscreen state isn't updated right after resize event on Mac (needs to wait for animation) so
  // we'll wait for a bit using the debounced window size. Hopefully Tauri eventually adds a way to listen
  // for fullscreen change events.

  return (
    useQuery({
      queryKey: ['is_fullscreen', debouncedWindowWidth],
      queryFn: async () => {
        return getCurrentWebviewWindow().isFullscreen();
      },
    }).data ?? false
  );
}
