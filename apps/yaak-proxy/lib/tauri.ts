import { invoke } from "@tauri-apps/api/core";
import { emit as tauriEmit, listen as tauriListen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { type as tauriOsType } from "@tauri-apps/plugin-os";
import { unsubscribeWhenReady } from "./unsubscribe";

/** Call a Tauri command. */
export function command<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return invoke(cmd, args) as Promise<T>;
}

/**
 * Subscribe to a Tauri event. Returns an unsubscribe function, which also removes a listener
 * still being registered once it is, and stops it delivering meanwhile: an effect cleaned up
 * that fast, as strict mode does to every one, would otherwise leave its listener attached and
 * hear each event twice.
 */
export function subscribe<T>(event: string, callback: (payload: T) => void): () => void {
  const subscription = unsubscribeWhenReady(
    tauriListen<T>(event, (e) => {
      if (subscription.active()) callback(e.payload);
    }),
  );
  return subscription.unsubscribe;
}

/** Calls `callback` each time the window regains focus. Returns an unsubscribe function. */
export function onWindowFocus(callback: () => void): () => void {
  const subscription = unsubscribeWhenReady(
    getCurrentWebviewWindow().onFocusChanged(
      ({ payload: focused }) => focused && subscription.active() && callback(),
    ),
  );
  return subscription.unsubscribe;
}

/** Show the current webview window. */
export function showWindow(): Promise<void> {
  return getCurrentWebviewWindow().show();
}

/** Close the current webview window. */
export function closeWindow(): Promise<void> {
  return getCurrentWebviewWindow().close();
}

/** The current window's label. */
export function currentWindowLabel(): string {
  return getCurrentWebviewWindow().label;
}

/** Send an event to every window of the app, this one included. */
export function broadcast(event: string, payload: unknown): Promise<void> {
  return tauriEmit(event, payload);
}

/** Get the current OS type (e.g. "macos", "linux", "windows"). */
export function getOsType() {
  return tauriOsType();
}
