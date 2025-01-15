import { useHotKey } from './useHotKey';
import { useListenToTauriEvent } from './useListenToTauriEvent';
import { useZoom } from './useZoom';

export function useSyncZoomSetting() {
  // Handle Zoom.
  // Note, Mac handles it in the app menu, so need to also handle keyboard
  // shortcuts for Windows/Linux
  const zoom = useZoom();
  useHotKey('app.zoom_in', zoom.zoomIn);
  useListenToTauriEvent('zoom_in', zoom.zoomIn);
  useHotKey('app.zoom_out', zoom.zoomOut);
  useListenToTauriEvent('zoom_out', zoom.zoomOut);
  useHotKey('app.zoom_reset', zoom.zoomReset);
  useListenToTauriEvent('zoom_reset', zoom.zoomReset);
}
