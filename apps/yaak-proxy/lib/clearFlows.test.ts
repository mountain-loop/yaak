import { createStore } from "jotai";
import { beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { clearFlowsAction, confirmClearFlowsAtom } from "./clearFlows";

describe("clearFlowsAction", () => {
  test("asks first while the preference is on", () => {
    expect(clearFlowsAction({ total: 3, locked: false, confirm: true })).toBe("confirm");
  });

  test("clears at once once asking is turned off", () => {
    expect(clearFlowsAction({ total: 3, locked: false, confirm: false })).toBe("clear");
  });

  test("does nothing with none to clear or traffic locked, whatever the preference", () => {
    for (const confirm of [true, false]) {
      expect(clearFlowsAction({ total: 0, locked: false, confirm })).toBe("disabled");
      expect(clearFlowsAction({ total: 3, locked: true, confirm })).toBe("disabled");
    }
  });
});

/** The preference as a new window reads it, once something shows it */
function mounted() {
  const store = createStore();
  const unsub = store.sub(confirmClearFlowsAtom, () => {});
  const value = store.get(confirmClearFlowsAtom);
  unsub();
  return value;
}

describe("confirmClearFlowsAtom", () => {
  let saved: Map<string, string>;

  beforeEach(() => {
    saved = new Map();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => saved.get(k) ?? null,
      setItem: (k: string, v: string) => void saved.set(k, v),
      removeItem: (k: string) => void saved.delete(k),
    });
  });

  test("is on by default", () => {
    expect(createStore().get(confirmClearFlowsAtom)).toBe(true);
  });

  test("keeps Don't ask again for later launches, until Settings turns it back on", () => {
    createStore().set(confirmClearFlowsAtom, false);
    expect(saved.get("confirm_clear_flows")).toBe("false");
    expect(mounted()).toBe(false);

    createStore().set(confirmClearFlowsAtom, true);
    expect(saved.get("confirm_clear_flows")).toBe("true");
    expect(mounted()).toBe(true);
  });
});
