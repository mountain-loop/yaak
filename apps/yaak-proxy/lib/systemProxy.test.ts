import { describe, expect, test } from "vite-plus/test";
import { helperRow, recordingLabel, type SystemProxyState, systemProxySwitch } from "./systemProxy";

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

  test("waits for no password when the helper makes the change", () => {
    expect(systemProxySwitch({ ...off, pending: false, helper: true })).toEqual({
      checked: false,
      description: "Changing the system proxy",
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

describe("helperRow", () => {
  test("offers each next step, and says which way changes go", () => {
    expect(helperRow("not_registered", "admin_prompt")).toMatchObject({
      title: "Helper: not installed",
      action: "install",
    });
    expect(helperRow("requires_approval", "admin_prompt")).toMatchObject({
      title: "Helper: awaiting approval in System Settings",
      action: "open_settings",
    });
    const enabled = helperRow("enabled", "helper");
    expect(enabled).toMatchObject({ title: "Helper: enabled", action: "unregister" });
    expect(enabled.description).toMatch(/no password/);
  });

  test("says when the password prompt still has settings to put back", () => {
    expect(helperRow("enabled", "admin_prompt").description).toMatch(/password prompt/);
  });

  test("says plainly that a dev build cannot use it", () => {
    expect(helperRow("unavailable", "admin_prompt")).toMatchObject({
      title: "Helper: not available in dev builds",
      action: null,
    });
  });
});

describe("recordingLabel", () => {
  test("offers the opposite of the current state", () => {
    expect(recordingLabel(true)).toBe("Pause Recording");
    expect(recordingLabel(false)).toBe("Resume Recording");
  });
});
