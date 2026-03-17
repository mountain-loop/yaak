import { getOsType } from "../lib/os";
import { useIsFullscreen } from "./useIsFullscreen";

export function useStoplightsVisible() {
  const fullscreen = useIsFullscreen();
  const stoplightsVisible = getOsType() === "macos" && !fullscreen;
  return stoplightsVisible;
}
