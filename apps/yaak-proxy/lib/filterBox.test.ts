import { describe, expect, test } from "vite-plus/test";
import {
  applyFromOutside,
  isUnapplied,
  pressEnter,
  pressEscape,
  type Recall,
  stepHistory,
} from "./filterBox";

describe("the draft and the applied filter", () => {
  test("Enter applies the draft, and keeps it unless it is blank", () => {
    expect(pressEnter({ draft: "@status:>=400 ", applied: "" })).toEqual({
      draft: "@status:>=400 ",
      apply: "@status:>=400",
      record: true,
    });
    expect(pressEnter({ draft: " ", applied: "stripe" })).toEqual({
      draft: " ",
      apply: "",
      record: false,
    });
  });

  test("a draft is unapplied while it differs from the filter, spaces aside", () => {
    expect(isUnapplied({ draft: "stripe", applied: "" })).toBe(true);
    expect(isUnapplied({ draft: "", applied: "stripe" })).toBe(true);
    expect(isUnapplied({ draft: "stripe ", applied: "stripe" })).toBe(false);
    expect(isUnapplied({ draft: "", applied: "" })).toBe(false);
  });

  test("Escape over an unapplied draft puts the applied filter back", () => {
    expect(pressEscape({ draft: "@host:x", applied: "stripe" })).toEqual({
      draft: "stripe",
      apply: null,
      record: false,
    });
    expect(pressEscape({ draft: "@host:x", applied: "" })).toEqual({
      draft: "",
      apply: null,
      record: false,
    });
  });

  test("Escape with nothing unapplied clears the filter and applies", () => {
    expect(pressEscape({ draft: "stripe", applied: "stripe" })).toEqual({
      draft: "",
      apply: "",
      record: false,
    });
  });

  test("Escape in an empty box is left to anything else", () => {
    expect(pressEscape({ draft: "", applied: "" })).toBeNull();
  });

  test("a filter set from outside the box applies at once, unrecorded", () => {
    expect(applyFromOutside("@host:api.stripe.com")).toEqual({
      draft: "@host:api.stripe.com",
      apply: "@host:api.stripe.com",
      record: false,
    });
  });
});

describe("stepping through the filter history", () => {
  const history = ["newest", "middle", "oldest"];

  function steps(keys: ("up" | "down")[], draft = ""): (string | null)[] {
    let recall: Recall | null = null;
    let text = draft;
    return keys.map((key) => {
      const next = stepHistory(history, recall, text, key);
      if (next == null) return null;
      recall = next.recall;
      text = next.draft;
      return text;
    });
  }

  test("Up from an empty box goes back through it, and stays at the oldest", () => {
    expect(steps(["up", "up", "up", "up"])).toEqual(["newest", "middle", "oldest", "oldest"]);
  });

  test("Down steps forward, then empties the box", () => {
    expect(steps(["up", "up", "down", "down", "down"])).toEqual([
      "newest",
      "middle",
      "newest",
      "",
      null,
    ]);
  });

  test("is not for a box with text of its own, or Down first", () => {
    expect(steps(["up"], "stripe")).toEqual([null]);
    expect(steps(["down"])).toEqual([null]);
    expect(stepHistory([], null, "", "up")).toBeNull();
  });

  test("typing over a recalled filter ends the stepping", () => {
    const first = stepHistory(history, null, "", "up");
    expect(first?.draft).toBe("newest");
    expect(stepHistory(history, first?.recall ?? null, "newest @x", "up")).toBeNull();
    expect(stepHistory(history, first?.recall ?? null, "newest @x", "down")).toBeNull();
  });
});
