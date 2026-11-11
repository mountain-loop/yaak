import { toastsAtom } from "@yaakapp-internal/ui/toast";
import { atom, createStore } from "jotai";
import { beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { DEFAULT_SETTINGS_VALUES } from "./settings";

const command = vi.fn<(cmd: string, args?: Record<string, unknown>) => Promise<unknown>>();

vi.mock("./tauri", () => ({
  command: (cmd: string, args?: Record<string, unknown>) => command(cmd, args),
  broadcast: vi.fn(),
  onWindowFocus: vi.fn(),
  subscribeHere: vi.fn(),
}));
vi.mock("./opener", () => ({ openLink: vi.fn() }));
// Outside the app there's no Tauri for the shared components' platform
vi.mock("@yaakapp-internal/platform", () => ({ platform: { osType: () => "macos" } }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: async () => "2026.11.0" }));
// The real atom reads local storage as it loads, which tests have none of
vi.mock("./interfaceSettings", () => ({ settingsValuesAtom: atom(DEFAULT_SETTINGS_VALUES) }));

const { checkArgs, checkForUpdatesNow, updateCheckingAtom } = await import("./updates");

async function messages(store: ReturnType<typeof createStore>) {
  // Toasts are added on the next tick
  await new Promise((resolve) => setTimeout(resolve, 0));
  return store.get(toastsAtom).map((t) => ({ color: t.color, message: t.message }));
}

describe("checkArgs", () => {
  test("sends the channel and download choice the settings make", () => {
    expect(checkArgs(DEFAULT_SETTINGS_VALUES, false)).toEqual({
      channel: "beta",
      background: false,
      autoDownload: true,
    });
    expect(
      checkArgs(
        { ...DEFAULT_SETTINGS_VALUES, updateChannel: "stable", autoDownloadUpdates: false },
        true,
      ),
    ).toEqual({ channel: "stable", background: true, autoDownload: false });
  });
});

describe("checkForUpdatesNow", () => {
  beforeEach(() => {
    command.mockReset();
  });

  test("says when there is nothing newer", async () => {
    command.mockResolvedValue(false);
    const store = createStore();
    await checkForUpdatesNow(store);
    expect(command).toHaveBeenCalledWith("cmd_check_for_updates", {
      channel: "beta",
      background: false,
      autoDownload: true,
    });
    expect(await messages(store)).toEqual([
      {
        color: "info",
        message: "No update available. You are on the latest version, 2026.11.0.",
      },
    ]);
    expect(store.get(updateCheckingAtom)).toBe(false);
  });

  test("leaves an update found to the prompt the backend sends", async () => {
    command.mockResolvedValue(true);
    const store = createStore();
    await checkForUpdatesNow(store);
    expect(await messages(store)).toEqual([]);
  });

  test("says, in a toast rather than a dialog, when the server can't be reached", async () => {
    command.mockRejectedValue("Updater error: error sending request");
    const store = createStore();
    await checkForUpdatesNow(store);
    expect(await messages(store)).toEqual([
      {
        color: "danger",
        message: "Could not check for updates: Updater error: error sending request",
      },
    ]);
    expect(store.get(updateCheckingAtom)).toBe(false);
  });
});
