import { describe, expect, test } from "vite-plus/test";
import { isImeCompositionEvent } from "./keyboard";

describe("isImeCompositionEvent", () => {
  test("detects an active standards-based composition", () => {
    expect(isImeCompositionEvent({ isComposing: true, keyCode: 13 })).toBe(true);
  });

  test("detects the Safari/WebKit key code fallback", () => {
    expect(isImeCompositionEvent({ isComposing: false, keyCode: 229 })).toBe(true);
  });

  test("does not classify an ordinary Enter keydown as composition", () => {
    expect(isImeCompositionEvent({ isComposing: false, keyCode: 13 })).toBe(false);
  });

  test("does not classify an ordinary Escape keydown as composition", () => {
    expect(isImeCompositionEvent({ isComposing: false, keyCode: 27 })).toBe(false);
  });
});
