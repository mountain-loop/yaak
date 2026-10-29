import { describe, expect, test } from "vite-plus/test";
import { recordingLabel, type SystemProxyState, systemProxySwitch } from "./systemProxy";

const off: SystemProxyState = { routing: false, port: 9090, pending: null, error: null };

describe("systemProxySwitch", () => {
  test("says whether this Mac's traffic is routed now", () => {
    expect(systemProxySwitch({ ...off, routing: true })).toEqual({
      checked: true,
      description: "Routing this Mac's web traffic through Yaak Proxy",
      failed: false,
    });
    expect(systemProxySwitch(off)).toEqual({
      checked: false,
      description: "Not routing. Only apps pointed at port 9090 are captured",
      failed: false,
    });
  });

  test("shows the new value while the password prompt is up", () => {
    expect(systemProxySwitch({ ...off, pending: true })).toEqual({
      checked: true,
      description: "Waiting for your password",
      failed: false,
    });
  });

  test("snaps back on a cancelled prompt and says so", () => {
    expect(systemProxySwitch({ ...off, error: "Cancelled in the password dialog" })).toEqual({
      checked: false,
      description: "Cancelled in the password prompt",
      failed: true,
    });
    expect(systemProxySwitch({ ...off, error: "networksetup failed" }).description).toBe(
      "networksetup failed",
    );
  });
});

describe("recordingLabel", () => {
  test("offers the opposite of the current state", () => {
    expect(recordingLabel(true)).toBe("Pause Recording");
    expect(recordingLabel(false)).toBe("Resume Recording");
  });
});
