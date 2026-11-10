import { createStore } from "jotai";
import { describe, expect, test, vi } from "vite-plus/test";

// The store reads the engine and the tree's selection through these; the toggle needs neither.
vi.mock("./rpc", () => ({ rpc: vi.fn(), listen: vi.fn() }));
vi.mock("@yaakapp-internal/ui", async () => {
  const { atom } = await vi.importActual<typeof import("jotai")>("jotai");
  return { selectedIdsFamily: () => atom<string[]>([]) };
});

const {
  activeQueryAtom,
  allTrafficTotalAtom,
  flowTotalAtom,
  hideEncryptedAtom,
  hideSystemAtom,
  allTrafficShownAtom,
} = await import("./store");

describe("Show in All Traffic, in System's menu", () => {
  test("shows System's traffic in All traffic by default", () => {
    const store = createStore();
    expect(store.get(hideSystemAtom)).toBe(false);
    expect(store.get(activeQueryAtom)).toBeNull();
  });

  test("leaves System out of All traffic and brings it back at once", () => {
    const store = createStore();
    store.set(allTrafficShownAtom, 3);
    expect(store.get(allTrafficTotalAtom)).toBe(store.get(flowTotalAtom));
    store.set(hideSystemAtom, true);
    expect(store.get(activeQueryAtom)).toEqual({
      query: "",
      hideSystem: true,
      hideEncrypted: false,
    });
    expect(store.get(allTrafficTotalAtom)).toBe(3);
    store.set(hideSystemAtom, false);
    expect(store.get(activeQueryAtom)).toBeNull();
    expect(store.get(allTrafficTotalAtom)).toBe(store.get(flowTotalAtom));
  });
});

describe("Show in All Traffic, in Encrypted's menu", () => {
  test("shows encrypted connections in All traffic by default", () => {
    expect(createStore().get(hideEncryptedAtom)).toBe(false);
  });

  test("leaves encrypted connections out of All traffic, with System or alone", () => {
    const store = createStore();
    store.set(allTrafficShownAtom, 5);
    store.set(hideEncryptedAtom, true);
    expect(store.get(activeQueryAtom)).toEqual({
      query: "",
      hideSystem: false,
      hideEncrypted: true,
    });
    expect(store.get(allTrafficTotalAtom)).toBe(5);
    store.set(hideSystemAtom, true);
    expect(store.get(activeQueryAtom)).toEqual({
      query: "",
      hideSystem: true,
      hideEncrypted: true,
    });
    store.set(hideEncryptedAtom, false);
    store.set(hideSystemAtom, false);
    expect(store.get(activeQueryAtom)).toBeNull();
    expect(store.get(allTrafficTotalAtom)).toBe(store.get(flowTotalAtom));
  });
});
