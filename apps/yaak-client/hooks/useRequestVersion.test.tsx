// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { RequestVersionComparison } from "@yaakapp-internal/models";
import { atom, getDefaultStore } from "jotai";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn<(cmd: string, args: { versionId: string }) => Promise<unknown>>(),
}));

vi.mock("../lib/rpc", () => ({ rpc: mocks.rpc }));
vi.mock("./useAllRequests", async () => {
  const { atom } = await import("jotai");
  return { allRequestsAtom: atom([{ id: "rq_1", updatedAt: "t1" }]) };
});

function comparison(versionId: string): RequestVersionComparison {
  return {
    version: { id: versionId, modelId: "rq_1" },
    currentDocument: {},
    differs: true,
  } as unknown as RequestVersionComparison;
}

/** Each version's comparison resolves only when the test says so. */
function deferredRpc() {
  const pending = new Map<string, () => void>();
  mocks.rpc.mockImplementation(
    (_cmd, { versionId }) =>
      new Promise((resolve) => pending.set(versionId, () => resolve(comparison(versionId)))),
  );
  return async (versionId: string) => {
    await vi.waitFor(() => expect(pending.has(versionId)).toBe(true));
    await act(async () => pending.get(versionId)?.());
  };
}

describe("useRequestVersion", () => {
  let container: HTMLDivElement;
  let root: Root;
  let seen: (RequestVersionComparison | null)[];
  let useRequestVersion: typeof import("./useRequestVersion").useRequestVersion;
  let allRequestsAtom: ReturnType<typeof atom<{ id: string; updatedAt: string }[]>>;
  const queryClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let client: QueryClient;

  function Probe({ versionId }: { versionId: string | null }) {
    seen.push(useRequestVersion(versionId, "rq_1"));
    return null;
  }

  async function show(versionId: string | null) {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <Probe versionId={versionId} />
        </QueryClientProvider>,
      ),
    );
  }

  const current = () => seen[seen.length - 1];

  /** Wait for the comparison for a version to reach the component. */
  async function answered(versionId: string) {
    await vi.waitFor(() => expect(current()?.version.id).toBe(versionId));
  }

  beforeEach(async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    ({ useRequestVersion } = await import("./useRequestVersion"));
    ({ allRequestsAtom } = (await import("./useAllRequests")) as unknown as {
      allRequestsAtom: typeof allRequestsAtom;
    });
    getDefaultStore().set(allRequestsAtom, [{ id: "rq_1", updatedAt: "t1" }]);
    client = queryClient();
    seen = [];
    container = document.createElement("div");
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    client.clear();
    mocks.rpc.mockReset();
  });

  test("a response with no version has no comparison, even right after one that had", async () => {
    const resolve = deferredRpc();
    await show("mv_a");
    await resolve("mv_a");
    await answered("mv_a");

    seen = [];
    await show(null);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((c) => c == null)).toBe(true);
  });

  test("switching versions never shows the previous version's comparison", async () => {
    const resolve = deferredRpc();
    await show("mv_a");
    await resolve("mv_a");
    await answered("mv_a");

    seen = [];
    await show("mv_b");
    // Still loading: nothing, rather than mv_a's answer
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((c) => c == null)).toBe(true);

    await resolve("mv_b");
    await answered("mv_b");
  });

  test("an edit to the live request keeps the answer while it refetches", async () => {
    const resolve = deferredRpc();
    await show("mv_a");
    await resolve("mv_a");
    await answered("mv_a");

    seen = [];
    await act(async () =>
      getDefaultStore().set(allRequestsAtom, [{ id: "rq_1", updatedAt: "t2" }]),
    );
    // The refetch is pending, but the dropdown does not flicker away meanwhile
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((c) => c?.version.id === "mv_a")).toBe(true);
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
  });
});
