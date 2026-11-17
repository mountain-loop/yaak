import { describe, expect, test } from "vite-plus/test";
import { countNewFlows, isAtEnd, resumesFollowing } from "./follow";

const at = (...times: string[]) => times.map((t) => ({ startedAt: `2026-10-26T10:00:${t}` }));

describe("countNewFlows", () => {
  test("counts flows that started after the hold", () => {
    expect(countNewFlows(at("01", "02", "03", "04"), "2026-10-26T10:00:02")).toBe(2);
  });

  test("counts every flow when there was no traffic at the hold", () => {
    expect(countNewFlows(at("01", "02"), null)).toBe(2);
  });

  test("keeps counting after a filter hides the flow the list was held on", () => {
    // Held while the newest flow overall started at :03, then filtered to a view without it
    expect(countNewFlows(at("01", "05", "06"), "2026-10-26T10:00:03")).toBe(2);
  });

  test("counts nothing when no flow in the view is new", () => {
    expect(countNewFlows(at("01", "02"), "2026-10-26T10:00:03")).toBe(0);
  });

  test("compares start times with and without fractional seconds", () => {
    expect(countNewFlows(at("03.5", "04"), "2026-10-26T10:00:03")).toBe(2);
    expect(countNewFlows(at("03", "03.25"), "2026-10-26T10:00:03.2")).toBe(1);
  });
});

describe("resumesFollowing", () => {
  const fits = { scrollHeight: 300, scrollTop: 0, clientHeight: 300 };
  const scrolledUp = { scrollHeight: 3000, scrollTop: 1200, clientHeight: 300 };
  const atBottom = { scrollHeight: 3000, scrollTop: 2700, clientHeight: 300 };

  test("follows again when the list fits its viewport, so it never shows new flows as unseen", () => {
    expect(isAtEnd(fits)).toBe(true);
    expect(resumesFollowing({ following: false, sorted: false, el: fits })).toBe(true);
  });

  test("follows again at the end of a list that overflows", () => {
    expect(resumesFollowing({ following: false, sorted: false, el: atBottom })).toBe(true);
  });

  test("stays held while scrolled up in a list that overflows", () => {
    expect(isAtEnd(scrolledUp)).toBe(false);
    expect(resumesFollowing({ following: false, sorted: false, el: scrolledUp })).toBe(false);
  });

  test("never follows while sorted, and has nothing to do while following", () => {
    expect(resumesFollowing({ following: false, sorted: true, el: fits })).toBe(false);
    expect(resumesFollowing({ following: true, sorted: false, el: fits })).toBe(false);
  });
});
