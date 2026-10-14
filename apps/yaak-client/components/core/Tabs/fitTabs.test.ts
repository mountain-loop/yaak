import { describe, expect, test } from "vite-plus/test";
import { fitTabs } from "./fitTabs";

const tabs = [
  { value: "body", width: 80, compactWidth: 66 },
  { value: "headers", width: 100, compactWidth: 86 },
  { value: "info", width: 60, compactWidth: 46 },
  { value: "assertions", width: 120, compactWidth: 106 },
];

describe("responsive request tabs", () => {
  test("restores the saved order when the pane has room for every tab", () => {
    expect(fitTabs(tabs, 500, "assertions")).toEqual(
      tabs.map(({ value, width }) => ({ value, width, spacingCompression: 0 })),
    );
  });

  test("tightens gaps and padding without taking any space from labels", () => {
    expect(fitTabs(tabs, 332, "assertions")).toEqual([
      { value: "body", width: 73, spacingCompression: 0.5 },
      { value: "headers", width: 93, spacingCompression: 0.5 },
      { value: "info", width: 53, spacingCompression: 0.5 },
      { value: "assertions", width: 113, spacingCompression: 0.5 },
    ]);
    expect(fitTabs(tabs, 304, "assertions")).toEqual(
      tabs.map(({ value, compactWidth }) => ({
        value,
        width: compactWidth,
        spacingCompression: 1,
      })),
    );
  });

  test("moves whole tabs into overflow when compact spacing is not enough", () => {
    expect(fitTabs(tabs, 258, "assertions")).toEqual([
      { value: "body", width: 66, spacingCompression: 1 },
      { value: "headers", width: 86, spacingCompression: 1 },
      { value: "assertions", width: 106, spacingCompression: 1 },
    ]);
    expect(fitTabs(tabs, 257, "assertions").map((tab) => tab.value)).toEqual([
      "body",
      "assertions",
    ]);
  });

  test("keeps an active tab from the end visible without reordering it", () => {
    expect(fitTabs(tabs, 172, "assertions")).toEqual([
      { value: "body", width: 66, spacingCompression: 1 },
      { value: "assertions", width: 106, spacingCompression: 1 },
    ]);
    expect(fitTabs(tabs, 170, "headers").map((tab) => tab.value)).toEqual(["body", "headers"]);
  });

  test("puts even the active tab into overflow if it cannot fit on its own", () => {
    expect(fitTabs(tabs, 40, "assertions")).toEqual([]);
    expect(fitTabs(tabs, 0, "assertions")).toEqual([]);
    expect(fitTabs(tabs, 90, "assertions")).toEqual([
      { value: "body", width: 80, spacingCompression: 0 },
    ]);
  });

  test("recalculates after a dropdown label or badge changes width", () => {
    const longLabel = [{ value: "body", width: 200, compactWidth: 186 }, ...tabs.slice(1)];
    const result = fitTabs(longLabel, 300, "body");
    expect(result.map((tab) => tab.value)).toEqual(["body", "headers"]);
    expect(result.reduce((sum, tab) => sum + tab.width, 0)).toBeCloseTo(300);

    const largeBadge = [{ value: "body", width: 240, compactWidth: 226 }, ...tabs.slice(1)];
    expect(fitTabs(largeBadge, 280, "body").map((tab) => tab.value)).toEqual(["body"]);
  });

  test("does not skip a long tab to squeeze later tabs into the leading group", () => {
    expect(fitTabs(tabs, 200, "assertions").map((tab) => tab.value)).toEqual([
      "body",
      "assertions",
    ]);
    expect(fitTabs(tabs, 160).map((tab) => tab.value)).toEqual(["body", "headers"]);
  });

  test("handles tabs with no spacing to compress", () => {
    const shortTabs = tabs.filter((tab) => tab.value === "body" || tab.value === "info");
    expect(fitTabs(shortTabs, 126, "body")).toEqual([
      { value: "body", width: 73, spacingCompression: 0.5 },
      { value: "info", width: 53, spacingCompression: 0.5 },
    ]);
    const fixedTabs = shortTabs.map((tab) => ({ ...tab, compactWidth: tab.width }));
    expect(fitTabs(fixedTabs, 126, "body")).toEqual([
      { value: "body", width: 80, spacingCompression: 0 },
    ]);
    expect(fitTabs(fixedTabs, 40, "body")).toEqual([]);
  });

  test("stays within the pane and each label's bounds throughout resizing", () => {
    for (let width = 0; width <= 500; width++) {
      for (const active of tabs) {
        const result = fitTabs(tabs, width, active.value);
        expect(result.some((tab) => tab.value === active.value)).toBe(width >= active.compactWidth);
        expect(result.reduce((sum, tab) => sum + tab.width, 0)).toBeLessThanOrEqual(width + 0.001);
        for (const tab of result) {
          const original = tabs.find((t) => t.value === tab.value)!;
          expect(tab.width).toBeGreaterThanOrEqual(original.compactWidth);
          expect(tab.width).toBeLessThanOrEqual(original.width);
          expect(tab.spacingCompression).toBeGreaterThanOrEqual(0);
          expect(tab.spacingCompression).toBeLessThanOrEqual(1);
          // All removed width must come from spacing, at every pane size.
          expect(original.width - tab.width).toBeCloseTo(
            tab.spacingCompression * (original.width - original.compactWidth),
          );
        }
      }
    }
  });
});
