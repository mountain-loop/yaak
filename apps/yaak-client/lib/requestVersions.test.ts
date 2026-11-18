import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  calls: [] as string[],
  finishWrites: null as (() => void) | null,
  flushAllModelWrites: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@yaakapp-internal/models", () => ({
  flushAllModelWrites: mocks.flushAllModelWrites,
  flushAllPendingPatches: vi.fn(),
}));
vi.mock("@yaakapp-internal/platform", () => ({ platform: {} }));
vi.mock("../hooks/useActiveRequestId", () => ({ activeRequestIdAtom: null }));
vi.mock("./jotai", () => ({ jotaiStore: {} }));
vi.mock("./rpc", () => ({ rpc: mocks.rpc }));

describe("snapshotRequestVersion", () => {
  beforeEach(() => {
    mocks.calls = [];
    mocks.flushAllModelWrites.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          mocks.calls.push("flush");
          mocks.finishWrites = () => {
            mocks.calls.push("writes landed");
            resolve();
          };
        }),
    );
    mocks.rpc.mockImplementation(async (cmd: string) => {
      mocks.calls.push(cmd);
      return { id: "mv_1" };
    });
  });

  test("asks for the snapshot only once pending writes have landed", async () => {
    const { snapshotRequestVersion } = await import("./requestVersions");
    snapshotRequestVersion("rq_1", "switch");
    await Promise.resolve();
    expect(mocks.calls).toEqual(["flush"]);

    mocks.finishWrites?.();
    await vi.waitFor(() =>
      expect(mocks.calls).toEqual(["flush", "writes landed", "models_snapshot_request"]),
    );
    expect(mocks.rpc).toHaveBeenCalledWith("models_snapshot_request", {
      requestId: "rq_1",
      reason: "switch",
    });
  });

  test("a failed write still lets the snapshot go ahead", async () => {
    mocks.flushAllModelWrites.mockRejectedValue(new Error("write failed"));
    const { snapshotRequestVersion } = await import("./requestVersions");
    snapshotRequestVersion("rq_1", "idle");
    await vi.waitFor(() => expect(mocks.rpc).toHaveBeenCalledTimes(1));
  });
});
