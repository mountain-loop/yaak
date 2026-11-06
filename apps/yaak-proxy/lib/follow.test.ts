import { describe, expect, test } from "vite-plus/test";
import { countNewFlows } from "./follow";

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
