import type { Context } from "@yaakapp/api";
import { describe, expect, it } from "vite-plus/test";
import { plugin } from "../src";

// A v6 UUID stores 60 bits of 100-nanosecond intervals since 1582-10-15 in its
// first three groups, with the version nibble removed.
function v6Millis(uuid: string): number {
  const hex = uuid.replace(/-/g, "");
  const intervals = BigInt(`0x${hex.slice(0, 12)}${hex.slice(13, 16)}`);
  return Number(intervals / 10000n) - 12219292800000;
}

describe("uuid.v6", () => {
  const v6 = plugin.templateFunctions?.find((f) => f.name === "uuid.v6");

  it("uses the current time when no usable timestamp is given", async () => {
    const inputs = [{}, { timestamp: "" }, { timestamp: null }, { timestamp: "not-a-date" }];
    for (const values of inputs) {
      const before = Date.now();
      const result = await v6?.onRender({} as Context, { values, purpose: "send" });
      const after = Date.now();

      expect(result).not.toMatch(/^00000000-0000-6/);
      const millis = v6Millis(result as string);
      expect(millis).toBeGreaterThanOrEqual(before);
      expect(millis).toBeLessThanOrEqual(after);
    }
  });

  it("embeds a timestamp that is given", async () => {
    const result = await v6?.onRender({} as Context, {
      values: { timestamp: "2025-05-28T11:15:00Z" },
      purpose: "send",
    });
    expect(v6Millis(result as string)).toBe(Date.parse("2025-05-28T11:15:00Z"));
  });
});
