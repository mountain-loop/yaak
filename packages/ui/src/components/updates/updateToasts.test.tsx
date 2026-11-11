import { createStore } from "jotai";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { toastsAtom } from "../../lib/toast";
import {
  showUpdateAvailableToast,
  showUpdateInstalledToast,
  showUpdateStateToast,
  UPDATE_STATE_TOAST_ID,
  UPDATE_TOAST_ID,
  updateStateMessage,
} from "./updateToasts";

function text(node: ReactNode) {
  return renderToStaticMarkup(<>{node}</>)
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** The toast shown, with its message and its action as they read */
function shown(store: ReturnType<typeof createStore>) {
  vi.runAllTimers();
  const toasts = store.get(toastsAtom);
  expect(toasts).toHaveLength(1);
  const toast = toasts[0]!;
  return {
    toast,
    message: text(toast.message),
    action: text(toast.action?.({ hide: () => {} }) ?? null),
  };
}

const noop = () => {};

describe("update toasts", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test("offers an update the app installs, in the app's name", () => {
    const store = createStore();
    showUpdateAvailableToast(store, {
      appName: "Yaak Proxy",
      update: { version: "2026.11.0", downloaded: false, install: "integrated" },
      onOpenUrl: noop,
      onInstall: noop,
    });
    const { toast, message, action } = shown(store);
    expect(toast.id).toBe(UPDATE_TOAST_ID);
    expect(toast.timeout).toBeNull();
    expect(message).toBe("Yaak Proxy 2026.11.0 is available Download and install the update?");
    // No release notes given, so no What's New
    expect(action).toBe("Download and Install");
  });

  test("offers What's New and installing a downloaded update, as Yaak's does", () => {
    const store = createStore();
    showUpdateAvailableToast(store, {
      appName: "Yaak",
      update: { version: "2026.11.0", downloaded: true, install: "integrated" },
      whatsNewUrl: "https://yaak.app/changelog/2026.11.0",
      downloadUrl: "https://yaak.app/download",
      onOpenUrl: noop,
      onInstall: noop,
    });
    const { message, action } = shown(store);
    expect(message).toBe("Yaak 2026.11.0 is available Do you want to install the update?");
    expect(action).toBe("Install Now What's New");
  });

  test("says how to update an install the app can't update itself", () => {
    const store = createStore();
    showUpdateAvailableToast(store, {
      appName: "Yaak",
      update: { version: "2026.11.0", downloaded: false, install: "manual" },
      downloadUrl: "https://yaak.app/download",
      onOpenUrl: noop,
      onInstall: noop,
    });
    const { message, action } = shown(store);
    expect(message).toBe("Yaak 2026.11.0 is available Download the new version to upgrade.");
    expect(action).toBe("Download");
  });

  test("offers to relaunch into an installed update", () => {
    const store = createStore();
    const onRelaunch = vi.fn();
    showUpdateInstalledToast(store, { appName: "Yaak Proxy", version: "2026.11.0", onRelaunch });
    const { message, action } = shown(store);
    expect(message).toBe("Yaak Proxy 2026.11.0 was installed Start using the new version now?");
    expect(action).toBe("Relaunch Yaak Proxy");
  });

  test("says where an update already in hand stands, apart from its prompt", () => {
    const store = createStore();
    showUpdateStateToast(store, {
      appName: "Yaak Proxy",
      state: { state: "downloading", version: "2026.11.0" },
    });
    const { toast, message } = shown(store);
    expect(toast.id).toBe(UPDATE_STATE_TOAST_ID);
    expect(toast.id).not.toBe(UPDATE_TOAST_ID);
    expect(message).toBe("Yaak Proxy 2026.11.0 is downloading.");
  });

  test("words each state, and shows nothing for idle", () => {
    expect(updateStateMessage("Yaak", { state: "checking" })).toBe("Already checking for updates.");
    expect(updateStateMessage("Yaak", { state: "offered", version: "1.0.0" })).toBe(
      "Yaak 1.0.0 is available.",
    );
    expect(updateStateMessage("Yaak", { state: "installing", version: "1.0.0" })).toBe(
      "Yaak 1.0.0 is installing.",
    );
    expect(updateStateMessage("Yaak", { state: "installed", version: "1.0.0" })).toBe(
      "Yaak 1.0.0 is installed. Relaunch to start using it.",
    );
    const store = createStore();
    expect(showUpdateStateToast(store, { appName: "Yaak", state: { state: "idle" } })).toBeNull();
    vi.runAllTimers();
    expect(store.get(toastsAtom)).toEqual([]);
  });
});
