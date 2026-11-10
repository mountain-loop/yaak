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
let lastFilter = "";
let windowPlaces: string | null = null;

vi.mock("./rpc", () => ({
  rpc: vi.fn(async (cmd: string, payload: { ids?: string[]; filter?: string }) => {
    if (cmd === "get_flows") {
      return (payload.ids ?? []).filter((id) => existing.has(id)).map((id) => flow(id));
    }
    if (cmd === "record_filter") recorded.push(payload.filter ?? "");
    if (cmd === "get_last_filter") return lastFilter;
    if (cmd === "get_window_places") return windowPlaces;
    if (cmd === "set_window_places") windowPlaces = (payload as { places: string }).places;
    if (cmd === "set_last_filter") lastFilter = payload.filter ?? "";
    return true;
  }),
  listen: vi.fn(() => () => {}),
}));
vi.mock("./tauri", () => ({ command: vi.fn(async () => {}), subscribe: vi.fn(() => () => {}) }));
// The package's index reaches for the window as it loads; the sidebar's selection is all used.
const sidebarSelection = vi.hoisted(() => ({ atom: null as unknown }));
vi.mock("@yaakapp-internal/ui", () => ({ selectedIdsFamily: () => sidebarSelection.atom }));

const {
  applyFilter,
  goToPlace,
  noteSidebarInput,
  searchDraftAtom,
  searchDraftVersionAtom,
  syncNavigation,
  syncSidebarSelection,
} = await import("./navigation");
const { sidebarFlowsAtom, sidebarTreeAtom } = await import("./store");
const { itemsById } = await import("./sidebarTree");

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
  sidebarSelection.atom = atom<string[]>([]);
  existing.clear();
  recorded.length = 0;
  lastFilter = "";
  windowPlaces = null;
});

describe("syncNavigation", () => {
  test("a launch restores the last filter applied, and keeps each one applied after", async () => {
    lastFilter = "@host:*.github.com";
    const store = createStore();
    await syncNavigation(store);
    await settle();
    expect(store.get(appliedFilterAtom)).toBe("@host:*.github.com");
    expect(store.get(searchDraftAtom)).toBe("@host:*.github.com");
    expect(store.get(canGoBackAtom)).toBe(false);

    applyFilter(store, "stripe");
    await settle();
    expect(lastFilter).toBe("stripe");
  });

  test("a launch the person has already moved on from keeps where they are", async () => {
    lastFilter = "old";
    const store = createStore();
    await syncNavigation(store);
    applyFilter(store, "new");
    await settle();
    expect(store.get(appliedFilterAtom)).toBe("new");
  });

  test("a reload takes back the places, the tabs and the selection, not the last filter", async () => {
    existing.add("B");
    lastFilter = "elsewhere";
    const before = createStore();
    await syncNavigation(before);
    applyFilter(before, "x");
    goToPlace(before, "add", { selection: ["B"], flow: flow("B") });
    goToPlace(before, "update", { tabs: { response: "headers" } });
    await settle();

    const after = createStore();
    await syncNavigation(after);
    await settle();
    expect(after.get(appliedFilterAtom)).toBe("x");
    expect(after.get(placeAtom).tabs).toEqual({ response: "headers" });
    expect(after.get(selectedFlowAtom)?.id).toBe("B");
    expect(goToPlace(after, "back")).toBe(true);
  });

  test("a late read of the selected flow leaves a newer one alone", async () => {
    existing.add("A");
    const store = newStore();
    goToPlace(store, "add", { selection: ["A"], flow: flow("A") });
    goToPlace(store, "add", { selection: ["B"], flow: flow("B") });
    store.set(selectedFlowAtom, null);
    goToPlace(store, "back");
    const newer = { ...flow("A"), status: 200 } as Flow;
    goToPlace(store, "update", { selection: ["A"], flow: newer });
    await settle();
    expect(store.get(selectedFlowAtom)).toBe(newer);
  });
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

describe("syncSidebarSelection", () => {
  function sidebar() {
    const store = newStore();
    const flows = ["https://a.example.com/x", "https://api.github.com/y", "https://api.stripe.com"];
    store.set(
      sidebarFlowsAtom,
      flows.map((url, i) => ({ id: `f${i}`, url, method: "GET" }) as Flow),
    );
    syncSidebarSelection(store);
    const selected = sidebarSelection.atom as ReturnType<typeof atom<string[]>>;
    const idOf = (label: string) =>
      [...itemsById(store.get(sidebarTreeAtom)).values()].find((i) => i.label === label)?.id ?? "";
    // As a click in the sidebar does
    const choose = (ids: string[]) => {
      noteSidebarInput();
      store.set(selected, ids);
    };
    return { store, selected, idOf, choose };
  }

  test("rows chosen together apply as one filter and stay selected", () => {
    const { store, selected, idOf, choose } = sidebar();
    const [example, github] = [idOf("example.com"), idOf("github.com")];
    choose([example]);
    choose([example, github]);
    expect(store.get(appliedFilterAtom)).toBe("@host:*.example.com OR @host:*.github.com");
    expect(store.get(selected)).toEqual([example, github]);
  });

  test("System's heading applies its query; the other headings apply nothing", () => {
    const { store, idOf, choose } = sidebar();
    store.set(sidebarFlowsAtom, [
      {
        id: "s",
        url: "https://ocsp.apple.com/x",
        method: "GET",
        clientName: "trustd",
        clientPath: "/usr/libexec/trustd",
      } as Flow,
    ]);
    choose([idOf("System")]);
    expect(store.get(appliedFilterAtom)).toBe("@is:system");
    choose([idOf("Domains")]);
    expect(store.get(appliedFilterAtom)).toBe("@is:system");
  });

  test("All traffic is exclusive either way round", () => {
    const { store, selected, idOf, choose } = sidebar();
    const [all, github] = [idOf("All traffic"), idOf("github.com")];
    choose([github]);
    choose([github, all]);
    expect(store.get(selected)).toEqual([all]);
    expect(store.get(appliedFilterAtom)).toBe("");
    choose([all, github]);
    expect(store.get(selected)).toEqual([github]);
    expect(store.get(appliedFilterAtom)).toBe("@host:*.github.com");
  });

  test("a box filter keeps the rows in it, and Back finds the rows again", () => {
    const { store, selected, idOf, choose } = sidebar();
    const [example, github] = [idOf("example.com"), idOf("github.com")];
    choose([example]);
    choose([example, github]);
    applyFilter(store, "@host:*.example.com @method:get", { record: true });
    expect(store.get(selected)).toEqual([example]);
    goToPlace(store, "back");
    expect(store.get(selected).sort()).toEqual([example, github].sort());
  });
});
