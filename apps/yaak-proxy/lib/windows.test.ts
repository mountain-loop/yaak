import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import { openSettingsVia, requestedSettingsTab, windowKind } from "./windows";

describe("windowKind", () => {
  test("the Settings window holds the settings", () => {
    expect(windowKind("other__settings")).toBe("settings");
  });

  test("a main window holds the app", () => {
    expect(windowKind("main_0")).toBe("main");
    expect(windowKind("main_3")).toBe("main");
  });

  test("a page outside the app's windows holds the app on its own", () => {
    expect(windowKind("harness")).toBe("page");
    expect(windowKind("settings")).toBe("page");
    expect(windowKind("settings_0")).toBe("page");
    expect(windowKind("")).toBe("page");
  });
});

describe("openSettingsVia", () => {
  function via(kind: Parameters<typeof windowKind>[0]) {
    return {
      kind: windowKind(kind),
      openWindow: vi.fn<(tab: string | null) => Promise<void>>().mockResolvedValue(undefined),
      openDialog: vi.fn<(tab: string | null) => void>(),
    };
  }

  test("the main window opens Settings in its own window, on the tab asked for", async () => {
    const v = via("main_0");
    await openSettingsVia("proxy", v);
    expect(v.openWindow).toHaveBeenCalledWith("proxy");
    expect(v.openDialog).not.toHaveBeenCalled();
  });

  test("with no tab, the window is brought forward where it is", async () => {
    const v = via("main_0");
    await openSettingsVia(null, v);
    expect(v.openWindow).toHaveBeenCalledWith(null);
  });

  test("a page with no second window opens the dialog instead", async () => {
    const v = via("harness");
    await openSettingsVia("theme", v);
    expect(v.openDialog).toHaveBeenCalledWith("theme");
    expect(v.openWindow).not.toHaveBeenCalled();
  });

  test("a window that fails to open says so", async () => {
    const v = via("main_0");
    v.openWindow.mockRejectedValue(new Error("no"));
    await expect(openSettingsVia("general", v)).rejects.toThrow("no");
  });
});

describe("requestedSettingsTab", () => {
  // The page's window, which the script `cmd_open_settings` passes sets the tab on
  const w = globalThis as { __YAAK_SETTINGS_TAB__?: unknown };
  afterEach(() => {
    delete w.__YAAK_SETTINGS_TAB__;
  });

  test("reads the tab the window was opened on", () => {
    w.__YAAK_SETTINGS_TAB__ = "proxy";
    expect(requestedSettingsTab()).toBe("proxy");
  });

  test("is none when the window was opened on no tab, or something else was set", () => {
    expect(requestedSettingsTab()).toBeNull();
    w.__YAAK_SETTINGS_TAB__ = 4;
    expect(requestedSettingsTab()).toBeNull();
  });
});
