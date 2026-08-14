import { useHotKey } from "./useHotKey";
import { usePlatformEvent } from "./usePlatformEvent";
import { useZoom } from "./useZoom";

export function useSyncZoomSetting() {
  // Handle Zoom.
  // Note, Mac handles it in the app menu, so need to also handle keyboard
  // shortcuts for Windows/Linux
  const zoom = useZoom();
  useHotKey("app.zoom_in", zoom.zoomIn);
  usePlatformEvent("zoom_in", zoom.zoomIn);
  useHotKey("app.zoom_out", zoom.zoomOut);
  usePlatformEvent("zoom_out", zoom.zoomOut);
  useHotKey("app.zoom_reset", zoom.zoomReset);
  usePlatformEvent("zoom_reset", zoom.zoomReset);
}
