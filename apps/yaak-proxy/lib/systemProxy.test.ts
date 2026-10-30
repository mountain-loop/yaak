import type { HelperState } from "@yaakapp-internal/proxy-lib";
import { describe, expect, test } from "vite-plus/test";
import {
  helperPollInterval,
  helperRow,
  recordingLabel,
  type SystemProxyState,
  systemProxySwitch,
} from "./systemProxy";

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
      title: "Helper: awaiting approval",
      action: "approve",
    });
    const enabled = helperRow("enabled", "helper");
    expect(enabled).toMatchObject({ title: "Helper: enabled", action: "unregister" });
    expect(enabled.description).toMatch(/No password/);
  });

  test("says when the password prompt still has settings to put back", () => {
    expect(helperRow("enabled", "admin_prompt").description).toMatch(/password prompt/);
  });

  test("offers to install when macOS can't find it, rather than blaming a dev build", () => {
    expect(helperRow("not_found", "admin_prompt")).toMatchObject({
      title: "Helper: not found by macOS",
      action: "install",
    });
  });

  test("keeps every row short", () => {
    const states: HelperState[] = [
      "unavailable",
      "not_found",
      "not_registered",
      "requires_approval",
      "enabled",
    ];
    for (const state of states) {
      for (const backend of ["helper", "admin_prompt"] as const) {
        const row = helperRow(state, backend);
        expect(row.title.length).toBeLessThanOrEqual(30);
        expect(row.description.length).toBeLessThanOrEqual(60);
      }
    }
  });

  test("has a titled row for every state the backend sends", () => {
    // A missing key here fails the typecheck, so a new state can't be left out.
    const states: Record<HelperState, true> = {
      unavailable: true,
      not_found: true,
      not_registered: true,
      requires_approval: true,
      enabled: true,
    };
    for (const state of Object.keys(states) as HelperState[]) {
      for (const backend of ["helper", "admin_prompt", "sudo"] as const) {
        expect(helperRow(state, backend).title).toMatch(/^Helper: \S/);
      }
    }
  });

  test("still gives a row for a state this build doesn't know", () => {
    const row = helperRow("from_the_future" as HelperState, "admin_prompt");
    expect(row).toEqual({
      title: "Helper: from_the_future",
      description: "Changes use the password prompt.",
      action: null,
    });
  });

  test("says plainly that a dev build cannot use it", () => {
    expect(helperRow("unavailable", "admin_prompt")).toMatchObject({
      title: "Helper: not in dev builds",
      action: null,
    });
  });
});

describe("helperPollInterval", () => {
  const now = 100_000;

  test("polls every 2 seconds while approval is pending", () => {
    expect(helperPollInterval("requires_approval", null, now)).toBe(2000);
  });

  test("stops once enabled or not registered, even just after registering", () => {
    expect(helperPollInterval("enabled", now - 500, now)).toBe(false);
    expect(helperPollInterval("not_registered", now - 500, now)).toBe(false);
  });

  test("polls briefly after registering, until approval shows", () => {
    expect(helperPollInterval("not_found", now - 500, now)).toBe(2000);
    expect(helperPollInterval(undefined, now - 500, now)).toBe(2000);
    expect(helperPollInterval("not_found", now - 10_000, now)).toBe(false);
  });

  test("never polls in other states", () => {
    for (const helper of ["unavailable", "not_found", undefined] as const) {
      expect(helperPollInterval(helper, null, now)).toBe(false);
    }
  });
});

describe("recordingLabel", () => {
  test("offers the opposite of the current state", () => {
    expect(recordingLabel(true)).toBe("Pause Recording");
    expect(recordingLabel(false)).toBe("Resume Recording");
  });
});
