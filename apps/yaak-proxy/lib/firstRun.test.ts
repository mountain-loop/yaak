import { describe, expect, test } from "vite-plus/test";
import { setupIncomplete } from "./firstRun";

describe("setupIncomplete", () => {
  const done = { trusted: true, systemProxySupported: true, systemProxyEverOn: true };

  test("is incomplete while the certificate is untrusted", () => {
    expect(setupIncomplete({ ...done, trusted: false })).toBe(true);
  });

  test("is incomplete until the system proxy has been on once", () => {
    expect(setupIncomplete({ ...done, systemProxyEverOn: false })).toBe(true);
    expect(setupIncomplete(done)).toBe(false);
  });

  test("needs no system proxy where there is none", () => {
    expect(
      setupIncomplete({ ...done, systemProxySupported: false, systemProxyEverOn: false }),
    ).toBe(false);
    expect(setupIncomplete({ ...done, systemProxySupported: false, trusted: false })).toBe(true);
  });

  test("waits for both to be read, so the card does not flash", () => {
    expect(setupIncomplete({ ...done, trusted: null })).toBe(false);
    expect(setupIncomplete({ ...done, systemProxySupported: null, trusted: false })).toBe(false);
  });
});
