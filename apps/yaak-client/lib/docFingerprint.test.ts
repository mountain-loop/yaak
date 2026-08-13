import { describe, expect, test } from "vite-plus/test";
import { docFingerprint } from "./docFingerprint";

const sampled = (text: string) => docFingerprint(text, { exact: false });
const exact = (text: string) => docFingerprint(text, { exact: true });

/** Same length as `text`, with one character changed at `at` */
const changeAt = (text: string, at: number) =>
  `${text.slice(0, at)}${text[at] === "b" ? "c" : "b"}${text.slice(at + 1)}`;

describe("docFingerprint", () => {
  test("is stable for the same text", () => {
    expect(sampled("hello")).toBe(sampled("hello"));
    expect(exact("hello")).toBe(exact("hello"));
  });

  test("differs on different short text", () => {
    expect(sampled("hello")).not.toBe(sampled("world"));
  });

  test("differs on length alone", () => {
    expect(sampled("a".repeat(1_000_000))).not.toBe(sampled("a".repeat(1_000_001)));
  });

  test("hashes small documents in full, so any change is caught", () => {
    const doc = "a".repeat(100);
    for (let i = 0; i < doc.length; i++) {
      expect(sampled(doc)).not.toBe(sampled(changeAt(doc, i)));
    }
  });

  describe("sampled", () => {
    const doc = "a".repeat(1_000_000);

    test("notices a change at the start", () => {
      expect(sampled(doc)).not.toBe(sampled(changeAt(doc, 0)));
    });

    test("notices a change at the end", () => {
      expect(sampled(doc)).not.toBe(sampled(changeAt(doc, doc.length - 1)));
    });

    test("notices a change in the middle", () => {
      expect(sampled(doc)).not.toBe(sampled(changeAt(doc, doc.length / 2)));
    });

    test("misses a same-length change between the samples", () => {
      // The documented cost of sampling. Read-only editors accept it because the worst a
      // collision can do there is restore a fold or the cursor to the wrong place.
      expect(sampled(doc)).toBe(sampled(changeAt(doc, 250_000)));
    });
  });

  describe("exact", () => {
    const doc = "a".repeat(1_000_000);

    test("catches a same-length change anywhere, which is why editable docs use it", () => {
      for (const at of [0, 250_000, doc.length / 2, 750_000, doc.length - 1]) {
        expect(exact(doc)).not.toBe(exact(changeAt(doc, at)));
      }
    });

    test("does not collide with the sampled fingerprint of the same text", () => {
      expect(exact(doc)).not.toBe(sampled(doc));
    });
  });
});
