import { describe, expect, test } from "vitest";
import { shouldRetryAfterFailure } from "./polling";

const NOW = 1_000_000_000;

describe("shouldRetryAfterFailure", () => {
  test("a query that has not failed always runs", () => {
    expect(shouldRetryAfterFailure(0, 0, NOW)).toBe(true);
  });

  test("waits 30s after the first failure", () => {
    expect(shouldRetryAfterFailure(1, NOW - 29_999, NOW)).toBe(false);
    expect(shouldRetryAfterFailure(1, NOW - 30_000, NOW)).toBe(true);
  });

  test("doubles the wait for each consecutive failure", () => {
    expect(shouldRetryAfterFailure(2, NOW - 59_999, NOW)).toBe(false);
    expect(shouldRetryAfterFailure(2, NOW - 60_000, NOW)).toBe(true);
    expect(shouldRetryAfterFailure(3, NOW - 119_999, NOW)).toBe(false);
    expect(shouldRetryAfterFailure(3, NOW - 120_000, NOW)).toBe(true);
  });

  test("caps the wait at ten minutes", () => {
    expect(shouldRetryAfterFailure(50, NOW - (10 * 60_000 - 1), NOW)).toBe(false);
    expect(shouldRetryAfterFailure(50, NOW - 10 * 60_000, NOW)).toBe(true);
  });
});
