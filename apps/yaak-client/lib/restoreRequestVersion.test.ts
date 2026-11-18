import type { ModelVersion } from "@yaakapp-internal/models";
import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  calls: [] as string[],
  flushAllModelWrites: vi.fn(),
  mergeModelsInStore: vi.fn(),
  wasUpdatedExternally: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@yaakapp-internal/models", () => ({
  flushAllModelWrites: mocks.flushAllModelWrites,
  mergeModelsInStore: mocks.mergeModelsInStore,
}));
vi.mock("../hooks/useRequestUpdateKey", () => ({
  wasUpdatedExternally: mocks.wasUpdatedExternally,
}));
vi.mock("./rpc", () => ({ rpc: mocks.rpc }));
vi.mock("./toast", () => ({ showToast: vi.fn() }));

const restored = { model: "http_request", id: "rq_1", url: "https://example.com/one" };
const version = { id: "mv_1", modelId: "rq_1" } as ModelVersion;

describe("applyRequestVersion", () => {
  beforeEach(() => {
    mocks.calls = [];
    mocks.flushAllModelWrites.mockImplementation(async () => mocks.calls.push("flush"));
    mocks.rpc.mockImplementation(async (cmd: string) => {
      mocks.calls.push(cmd);
      return restored;
    });
    mocks.mergeModelsInStore.mockImplementation(() => mocks.calls.push("store"));
    mocks.wasUpdatedExternally.mockImplementation(() => mocks.calls.push("editors"));
  });

  test("puts the restored request in the store before editors re-read it", async () => {
    const { applyRequestVersion } = await import("./restoreRequestVersion");
    await applyRequestVersion(version);

    expect(mocks.calls).toEqual(["flush", "models_restore_request_version", "store", "editors"]);
    expect(mocks.mergeModelsInStore).toHaveBeenCalledWith("http_request", [restored]);
    expect(mocks.wasUpdatedExternally).toHaveBeenCalledWith("rq_1");
  });

  test("a failed restore leaves the store and editors alone", async () => {
    mocks.rpc.mockRejectedValue(new Error("no such version"));
    const { applyRequestVersion } = await import("./restoreRequestVersion");

    await expect(applyRequestVersion(version)).rejects.toThrow("no such version");
    expect(mocks.mergeModelsInStore).not.toHaveBeenCalled();
    expect(mocks.wasUpdatedExternally).not.toHaveBeenCalled();
  });
});
