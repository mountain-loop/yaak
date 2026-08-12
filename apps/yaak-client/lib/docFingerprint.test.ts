import { describe, expect, test } from "vite-plus/test";
import { docFingerprint } from "./docFingerprint";

describe("docFingerprint", () => {
  test("is stable for the same text", () => {
    expect(docFingerprint("hello")).toBe(docFingerprint("hello"));
  });

  test("differs on different short text", () => {
    expect(docFingerprint("hello")).not.toBe(docFingerprint("world"));
  });

  test("differs on length alone", () => {
    expect(docFingerprint("a".repeat(1_000_000))).not.toBe(docFingerprint("a".repeat(1_000_001)));
  });

  test("notices a change at the start of a large document", () => {
    const doc = "a".repeat(1_000_000);
    expect(docFingerprint(doc)).not.toBe(docFingerprint(`b${doc.slice(1)}`));
  });

  test("notices a change at the end of a large document", () => {
    const doc = "a".repeat(1_000_000);
    expect(docFingerprint(doc)).not.toBe(docFingerprint(`${doc.slice(0, -1)}b`));
  });

  test("notices a change in the middle of a large document", () => {
    const doc = "a".repeat(1_000_000);
    const middle = doc.length / 2;
    const changed = `${doc.slice(0, middle)}b${doc.slice(middle + 1)}`;
    expect(doc.length).toBe(changed.length);
    expect(docFingerprint(doc)).not.toBe(docFingerprint(changed));
  });

  test("hashes small documents in full, so any change is caught", () => {
    const doc = "a".repeat(100);
    for (let i = 0; i < doc.length; i++) {
      const changed = `${doc.slice(0, i)}b${doc.slice(i + 1)}`;
      expect(docFingerprint(doc)).not.toBe(docFingerprint(changed));
    }
  });
});
