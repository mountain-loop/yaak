import { useWindowSize } from 'react-use';

const WINDOW_FLOATING_SIDEBAR_WIDTH = 600;

export function useShouldFloatSidebar() {
  const windowSize = useWindowSize();
  return windowSize.width <= WINDOW_FLOATING_SIDEBAR_WIDTH;
}
