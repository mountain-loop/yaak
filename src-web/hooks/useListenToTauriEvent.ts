import type { EventCallback, EventName } from '@tauri-apps/api/event';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { useEffect, useRef } from 'react';

export function useListenToTauriEvent<T>(event: EventName, fn: EventCallback<T>) {
  const handlerRef = useRef(fn);
  useEffect(() => {
    handlerRef.current = fn;
  }, [fn]);

  useEffect(() => {
    return listenToTauriEvent<T>(event, (p) => handlerRef.current(p));
  }, [event]);
}

export function listenToTauriEvent<T>(event: EventName, fn: EventCallback<T>) {
  const unsubPromise = listen<T>(
    event,
    fn,
    // Listen to `emit_all()` events or events specific to the current window
    { target: { label: getCurrentWebviewWindow().label, kind: 'Window' } },
  );

  return () => {
    unsubPromise.then((unsub) => unsub()).catch(console.error);
  };
}
