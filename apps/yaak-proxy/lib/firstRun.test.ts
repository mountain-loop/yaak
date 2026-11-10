import { describe, expect, test } from "vite-plus/test";
import { decryptStep, setupIncomplete } from "./firstRun";

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

describe("decryptStep", () => {
  const builtIns = [{ entry: "!host:*.apple.com", builtIn: true }];

  test("picks hosts as they appear by default, after the certificate", () => {
    expect(decryptStep(builtIns, false)).toEqual({ choice: "pick", state: "todo" });
    expect(decryptStep(builtIns, true)).toEqual({ choice: "pick", state: "next" });
  });

  test("is done once everything, or a host, is on the list", () => {
    const everything = [{ entry: "*", builtIn: false }, ...builtIns];
    expect(decryptStep(everything, true)).toEqual({ choice: "everything", state: "done" });
    const host = [{ entry: "host:api.example.com", builtIn: false }];
    expect(decryptStep(host, true)).toEqual({ choice: "pick", state: "done" });
    // An exclusion alone decrypts nothing.
    expect(decryptStep([{ entry: "!host:a.com", builtIn: false }], true).state).toBe("next");
  });
});
