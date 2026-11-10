import type { Flow } from "@yaakapp-internal/proxy-lib";
import { atom, createStore } from "jotai";
import { beforeEach, describe, expect, test, vi } from "vite-plus/test";
import {
  appliedFilterAtom,
  canGoBackAtom,
  canGoForwardAtom,
  placeAtom,
  placeStackAtom,
  revealFlowAtom,
  selectedFlowAtom,
} from "./atoms";
import { EMPTY_PLACE, stackOf } from "./places";

const existing = new Set<string>();
const recorded: string[] = [];

vi.mock("./rpc", () => ({
  rpc: vi.fn(async (cmd: string, payload: { ids?: string[]; filter?: string }) => {
    if (cmd === "get_flows") {
      return (payload.ids ?? []).filter((id) => existing.has(id)).map((id) => flow(id));
    }
    if (cmd === "record_filter") recorded.push(payload.filter ?? "");
    return true;
  }),
  listen: vi.fn(() => () => {}),
}));
vi.mock("./tauri", () => ({ command: vi.fn(async () => {}), subscribe: vi.fn(() => () => {}) }));
// The package's index reaches for the window as it loads; the sidebar's selection is all used.
vi.mock("@yaakapp-internal/ui", () => ({ selectedIdsFamily: () => atom<string[]>([]) }));

const { applyFilter, goToPlace, searchDraftAtom, searchDraftVersionAtom } =
  await import("./navigation");

function flow(id: string): Flow {
  return { id } as Flow;
}

function newStore() {
  const store = createStore();
  store.set(placeStackAtom, stackOf(EMPTY_PLACE));
  return store;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  existing.clear();
  recorded.length = 0;
});

describe("goToPlace", () => {
  test("a click, a run of arrow keys and a filter go back as two places", () => {
    const store = newStore();
    applyFilter(store, "before");
    goToPlace(store, "add", { selection: ["A"], flow: flow("A") });
    for (let i = 0; i < 50; i++) {
      goToPlace(store, "update", { selection: [`row${i}`], flow: flow(`row${i}`) });
    }
    goToPlace(store, "update", { selection: ["B"], flow: flow("B") });
    applyFilter(store, "after");
    expect(store.get(placeStackAtom).places.length).toBe(4);

    expect(goToPlace(store, "back")).toBe(true);
    expect(store.get(appliedFilterAtom)).toBe("before");
    expect(store.get(selectedFlowAtom)?.id).toBe("B");
    expect(store.get(searchDraftAtom)).toBe("before");
    expect(store.get(revealFlowAtom)).toEqual({ id: "B" });

    goToPlace(store, "back");
    expect(store.get(appliedFilterAtom)).toBe("before");
    expect(store.get(selectedFlowAtom)).toBeNull();
    expect(store.get(canGoForwardAtom)).toBe(true);

    goToPlace(store, "forward");
    goToPlace(store, "forward");
    expect(store.get(appliedFilterAtom)).toBe("after");
    expect(store.get(canGoForwardAtom)).toBe(false);
    expect(goToPlace(store, "forward")).toBe(false);
  });

  test("a new selection opens on the card's own tabs; the same one keeps them", () => {
    const store = newStore();
    goToPlace(store, "add", { selection: ["A"], flow: flow("A") });
    goToPlace(store, "update", { tabs: { response: "headers" } });
    goToPlace(store, "add", { selection: ["A"], flow: flow("A") });
    expect(store.get(placeAtom).tabs).toEqual({ response: "headers" });
    expect(store.get(placeStackAtom).places.length).toBe(2);
    goToPlace(store, "update", { selection: ["B"], flow: flow("B") });
    expect(store.get(placeAtom).tabs).toEqual({});
  });

  test("going back restores the tabs that place had open", () => {
    const store = newStore();
    goToPlace(store, "add", { selection: ["A"], flow: flow("A") });
    goToPlace(store, "update", { tabs: { request: "params" } });
    goToPlace(store, "add", { selection: ["B"], flow: flow("B") });
    goToPlace(store, "back");
    expect(store.get(placeAtom).tabs).toEqual({ request: "params" });
  });

  test("a place whose flow is gone comes back with its filter and no selection", async () => {
    const store = newStore();
    applyFilter(store, "x");
    goToPlace(store, "add", { selection: ["gone"], flow: flow("gone") });
    applyFilter(store, "y");
    store.set(selectedFlowAtom, null);
    goToPlace(store, "add", { selection: ["other"], flow: flow("other") });

    goToPlace(store, "back");
    goToPlace(store, "back");
    expect(store.get(appliedFilterAtom)).toBe("x");
    await settle();
    expect(store.get(selectedFlowAtom)).toBeNull();
    expect(store.get(placeAtom).selection.size).toBe(0);
  });

  test("a place whose flow the window doesn't hold reads it", async () => {
    existing.add("old");
    const store = newStore();
    goToPlace(store, "add", { selection: ["old"], flow: flow("old") });
    goToPlace(store, "add", { selection: ["new"], flow: flow("new") });
    goToPlace(store, "back");
    await settle();
    expect(store.get(selectedFlowAtom)?.id).toBe("old");
  });

  test("only filters applied with record go to the history", async () => {
    const store = newStore();
    applyFilter(store, "@status:>=400", { record: true });
    applyFilter(store, "@host:sidebar");
    applyFilter(store, "", { record: true });
    await settle();
    expect(recorded).toEqual(["@status:>=400"]);
    expect(store.get(canGoBackAtom)).toBe(true);
  });

  test("the box takes a filter from outside, but not one it holds already", () => {
    const store = newStore();
    store.set(searchDraftAtom, "stripe ");
    const version = store.get(searchDraftVersionAtom);
    applyFilter(store, "stripe");
    expect(store.get(searchDraftVersionAtom)).toBe(version);
    applyFilter(store, "@host:x");
    expect(store.get(searchDraftAtom)).toBe("@host:x");
    expect(store.get(searchDraftVersionAtom)).toBe(version + 1);
  });
});
