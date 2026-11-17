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
      description: "Traffic from every app will be recorded.",
      failed: false,
    });
    expect(systemProxySwitch(off)).toEqual({
      checked: false,
      description: "Only traffic sent to port 9090 will be recorded.",
      failed: false,
    });
  });

  test("shows the new value while the password prompt is up", () => {
    expect(systemProxySwitch({ ...off, pending: true })).toEqual({
      checked: true,
      description: "Waiting for macOS",
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
    expect(systemProxySwitch({ ...off, error: "The password prompt was cancelled." })).toEqual({
      checked: false,
      description: "The password prompt was cancelled.",
      failed: true,
    });
    expect(systemProxySwitch({ ...off, error: "networksetup failed" }).description).toBe(
      "networksetup failed",
    );
  });
});

describe("helperRow", () => {
  test("offers each next step, and says what the helper is for", () => {
    expect(helperRow("not_registered", "admin_prompt")).toMatchObject({
      description: "The helper is not installed.",
      action: "install",
    });
    expect(helperRow("requires_approval", "admin_prompt")).toMatchObject({
      description: "The helper is awaiting approval.",
      action: "approve",
    });
    const enabled = helperRow("enabled", "helper");
    expect(enabled).toMatchObject({
      description: "The helper is installed.",
      action: "unregister",
    });
    expect(enabled.tooltip).toMatch(/without a password prompt/);
  });

  test("says when the password prompt still has settings to put back", () => {
    expect(helperRow("enabled", "admin_prompt").tooltip).toBe(
      "One more password prompt is needed to restore the system proxy settings.",
    );
  });

  test("offers to install when macOS can't find it, rather than blaming a dev build", () => {
    expect(helperRow("not_found", "admin_prompt")).toMatchObject({
      description: "macOS could not find the helper.",
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
        expect(row.description.length).toBeLessThanOrEqual(60);
        expect(row.tooltip.length).toBeLessThanOrEqual(80);
      }
    }
  });

  test("has a row for every state the backend sends", () => {
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
        expect(helperRow(state, backend).description).toMatch(/helper.*\.$/);
      }
    }
  });

  test("still gives a row for a state this build doesn't know", () => {
    const row = helperRow("from_the_future" as HelperState, "admin_prompt");
    expect(row).toEqual({
      description: "The helper is from_the_future.",
      tooltip: "The helper changes the system proxy without a password prompt.",
      action: null,
    });
  });

  test("says plainly that a dev build cannot use it", () => {
    expect(helperRow("unavailable", "admin_prompt")).toMatchObject({
      description: "The helper is not available in dev builds.",
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
