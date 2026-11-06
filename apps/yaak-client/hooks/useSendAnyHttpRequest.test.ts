import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  platform: { httpProxyUrl: "https://web.yaak.test" as string | null },
  showConfirm: vi.fn<() => Promise<boolean>>(),
  flushAllModelWrites: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@yaakapp-internal/platform", () => ({ platform: mocks.platform }));
vi.mock("@yaakapp-internal/models", () => ({ flushAllModelWrites: mocks.flushAllModelWrites }));
vi.mock("../lib/confirm", () => ({ showConfirm: mocks.showConfirm }));
vi.mock("../lib/appInfo", () => ({ appInfo: { identifier: "app.yaak.web" } }));
vi.mock("../lib/rpc", () => ({ rpc: mocks.rpc }));
vi.mock("../lib/toast", () => ({ showToast: vi.fn() }));
vi.mock("./useActiveCookieJar", () => ({ getActiveCookieJar: () => ({ id: "cj_test" }) }));
vi.mock("./useActiveEnvironment", () => ({ getActiveEnvironment: () => ({ id: "ev_test" }) }));

async function sender() {
  return (await import("./useSendAnyHttpRequest")).sendAnyHttpRequest;
}

describe("web proxy confirmation before sending", () => {
  let stored: Map<string, string>;

  beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();
    mocks.platform.httpProxyUrl = "https://web.yaak.test";
    mocks.rpc.mockResolvedValue({ id: "rs_test" });
    stored = new Map();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  test("blocks all pending sends until one shared confirmation is accepted", async () => {
    let decide!: (accepted: boolean) => void;
    mocks.showConfirm.mockReturnValue(
      new Promise((resolve) => {
        decide = resolve;
      }),
    );
    const send = await sender();
    const first = send.mutateAsync("rq_one");
    const second = send.mutateAsync("rq_two");

    expect(mocks.showConfirm).toHaveBeenCalledTimes(1);
    expect(mocks.flushAllModelWrites).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
    decide(true);
    await Promise.all([first, second]);

    expect(mocks.rpc).toHaveBeenCalledTimes(2);
    expect(mocks.rpc).toHaveBeenCalledWith("cmd_send_http_request", {
      requestId: "rq_one",
      environmentId: "ev_test",
      cookieJarId: "cj_test",
    });
    expect(stored.size).toBe(1);
  });

  test("cancel sends nothing, remembers nothing, and asks again next time", async () => {
    mocks.showConfirm.mockResolvedValue(false);
    const send = await sender();
    expect(await send.mutateAsync("rq_one")).toBeNull();
    expect(await send.mutateAsync("rq_one")).toBeNull();
    expect(mocks.showConfirm).toHaveBeenCalledTimes(2);
    expect(mocks.flushAllModelWrites).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(stored.size).toBe(0);
  });

  test("cancel applies to every send waiting on the dialog", async () => {
    mocks.showConfirm.mockResolvedValue(false);
    const send = await sender();
    expect(await Promise.all([send.mutateAsync("rq_one"), send.mutateAsync("rq_two")])).toEqual([
      null,
      null,
    ]);
    expect(mocks.showConfirm).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  test("remembers acceptance across module reloads for the same proxy", async () => {
    mocks.showConfirm.mockResolvedValue(true);
    await (await sender()).mutateAsync("rq_one");
    vi.resetModules();
    await (await sender()).mutateAsync("rq_two");
    expect(mocks.showConfirm).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
  });

  test("requires a new decision when the proxy changes", async () => {
    mocks.showConfirm.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const send = await sender();
    await send.mutateAsync("rq_one");
    mocks.platform.httpProxyUrl = "https://another-proxy.test";
    expect(await send.mutateAsync("rq_two")).toBeNull();
    expect(mocks.showConfirm).toHaveBeenCalledTimes(2);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });

  test("still asks and remembers in this tab if browser storage is unavailable", async () => {
    const unavailable = () => {
      throw new Error("Storage unavailable");
    };
    vi.stubGlobal("localStorage", { getItem: unavailable, setItem: unavailable });
    mocks.showConfirm.mockResolvedValue(true);
    const send = await sender();
    await send.mutateAsync("rq_one");
    await send.mutateAsync("rq_two");
    expect(mocks.showConfirm).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
  });

  test("desktop sends directly without confirmation", async () => {
    mocks.platform.httpProxyUrl = null;
    await (await sender()).mutateAsync("rq_one");
    expect(mocks.showConfirm).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(stored.size).toBe(0);
  });

  test("an empty selection does not prompt or send", async () => {
    expect(await (await sender()).mutateAsync(null)).toBeNull();
    expect(mocks.showConfirm).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
