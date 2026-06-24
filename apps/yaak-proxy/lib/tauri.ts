import { invoke } from "@tauri-apps/api/core";
import { listen as tauriListen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { type as tauriOsType } from "@tauri-apps/plugin-os";

/** Call a Tauri command. */
export function command<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return invoke(cmd, args) as Promise<T>;
}

/** Subscribe to a Tauri event. Returns an unsubscribe function. */
export function subscribe<T>(event: string, callback: (payload: T) => void): () => void {
  let unsub: (() => void) | null = null;
  tauriListen<T>(event, (e) => callback(e.payload))
    .then((fn) => {
      unsub = fn;
    })
    .catch(console.error);
  return () => unsub?.();
}

/** Show the current webview window. */
export function showWindow(): Promise<void> {
  return getCurrentWebviewWindow().show();
}

/** Get the current OS type (e.g. "macos", "linux", "windows"). */
export function getOsType() {
  return tauriOsType();
}
