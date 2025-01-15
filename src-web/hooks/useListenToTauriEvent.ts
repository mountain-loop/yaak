import type { EventCallback, EventName } from '@tauri-apps/api/event';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { useEffect } from 'react';

/**
 * React hook to listen to a Tauri event.
 */
export function useListenToTauriEvent<T>(event: EventName, fn: EventCallback<T>) {
  useEffect(() => listenToTauriEvent(event, fn), [event, fn]);
}

export function listenToTauriEvent<T>(event: EventName, fn: EventCallback<T>) {
  const unlisten = listen<T>(
    event,
    fn,
    // Listen to `emit_all()` events or events specific to the current window
    { target: { label: getCurrentWebviewWindow().label, kind: 'Window' } },
  );

  return () => {
    unlisten.then((fn) => fn());
  };
}
