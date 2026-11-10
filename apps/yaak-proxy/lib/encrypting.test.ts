import { describe, expect, test } from "vite-plus/test";
import { encryptingPercent } from "./encrypting";

describe("encryptingPercent", () => {
  const state = (encrypting: number | null) =>
    ({ encrypting }) as Parameters<typeof encryptingPercent>[0];

  test("is null when nothing is being encrypted", () => {
    expect(encryptingPercent(null)).toBeNull();
    expect(encryptingPercent(state(null))).toBeNull();
  });

  test("rounds down and stays within 0 and 100", () => {
    expect(encryptingPercent(state(0))).toBe("0%");
    expect(encryptingPercent(state(0.426))).toBe("42%");
    expect(encryptingPercent(state(0.999))).toBe("99%");
    expect(encryptingPercent(state(1))).toBe("100%");
    expect(encryptingPercent(state(1.2))).toBe("100%");
  });
});
