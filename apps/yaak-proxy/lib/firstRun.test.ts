import { describe, expect, test } from "vite-plus/test";
import { setupIncomplete } from "./firstRun";

describe("setupIncomplete", () => {
  const done = { systemProxySupported: true, systemProxyEverOn: true };

  test("is incomplete until the system proxy has been on once", () => {
    expect(setupIncomplete({ ...done, systemProxyEverOn: false })).toBe(true);
    expect(setupIncomplete(done)).toBe(false);
  });

  test("needs no system proxy where there is none", () => {
    expect(
      setupIncomplete({ ...done, systemProxySupported: false, systemProxyEverOn: false }),
    ).toBe(false);
  });

  test("waits for the system proxy to be read, so the card does not flash", () => {
    expect(setupIncomplete({ ...done, systemProxySupported: null, systemProxyEverOn: false })).toBe(
      false,
    );
  });
});
