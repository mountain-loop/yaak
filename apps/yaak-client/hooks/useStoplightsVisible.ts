import { platform } from "@yaakapp-internal/platform";
import { useIsFullscreen } from "@yaakapp-internal/ui";

export function useStoplightsVisible() {
  const fullscreen = useIsFullscreen();
  const stoplightsVisible = platform.osType() === "macos" && !fullscreen;
  return stoplightsVisible;
}
