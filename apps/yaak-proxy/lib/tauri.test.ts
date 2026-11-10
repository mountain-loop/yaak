import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

type Handler = (e: { payload: unknown }) => void;

/** Listeners Tauri holds, and the registrations not yet resolved */
const listeners = new Set<Handler>();
let pending: (() => void)[] = [];

vi.mock("@tauri-apps/api/event", () => ({
  // Registers asynchronously, as Tauri does, resolving only when the test lets it.
  listen: (_event: string, handler: Handler) =>
    new Promise<() => void>((resolve) => {
      pending.push(() => {
        listeners.add(handler);
        resolve(() => listeners.delete(handler));
      });
    }),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({ getCurrentWebviewWindow: vi.fn() }));
vi.mock("@tauri-apps/plugin-os", () => ({ type: vi.fn() }));

const { subscribe } = await import("./tauri");

async function register() {
  for (const resolve of pending) resolve();
  pending = [];
  await Promise.resolve();
  await Promise.resolve();
}

function emit(payload: unknown) {
  for (const handler of listeners) handler({ payload });
}

describe("subscribe", () => {
  beforeEach(() => {
    listeners.clear();
    pending = [];
  });

  test("an effect cleaned up before its listener registers hears nothing, as in strict mode", async () => {
    const heard = vi.fn();
    // Strict mode: subscribe, clean up at once, subscribe again
    const first = subscribe("menu_export_har", heard);
    first();
    const second = subscribe("menu_export_har", heard);
    await register();
    emit(null);
    expect(heard).toHaveBeenCalledTimes(1);
    expect(listeners.size).toBe(1);
    second();
    expect(listeners.size).toBe(0);
  });

  test("delivers events until unsubscribed", async () => {
    const heard = vi.fn();
    const unsubscribe = subscribe<number>("menu_export_har", heard);
    await register();
    emit(1);
    unsubscribe();
    emit(2);
    expect(heard.mock.calls).toEqual([[1]]);
  });
});
