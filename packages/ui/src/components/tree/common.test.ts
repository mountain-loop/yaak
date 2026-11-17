import { describe, expect, test } from "vite-plus/test";
import { tabbableSelection } from "./common";

describe("tabbableSelection", () => {
  test("leaves several selected rows alone while the last one focused is in view", () => {
    // As the tree renders again, say for new counts, the selection stands.
    expect(tabbableSelection(["a", "b", "c"], "b", "b")).toBeNull();
    expect(tabbableSelection(["b"], "b", "b")).toBeNull();
  });

  test("moves to the closest row in view once the last one focused is hidden", () => {
    expect(tabbableSelection(["a", "child"], "child", "parent")).toEqual(["parent"]);
  });

  test("selects the last row focused when the selection no longer holds it", () => {
    expect(tabbableSelection([], "b", "b")).toEqual(["b"]);
    expect(tabbableSelection(["a"], "b", "b")).toEqual(["b"]);
  });
});
