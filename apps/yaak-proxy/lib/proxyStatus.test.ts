import type { GetProxyStateResponse } from "@yaakapp-internal/proxy-lib";
import { describe, expect, test } from "vite-plus/test";
import { proxyStatusOf, statusTintColor } from "./proxyStatus";

const base: GetProxyStateResponse = {
  state: "running",
  port: 9090,
  configuredPort: 9090,
  recording: true,
  systemProxyAtLaunch: true,
  httpVersion: "auto",
  captureBodyLimit: 10 * 1024 * 1024,
  traffic: "keep",
  keepTrafficBytes: null,
  startError: null,
  encrypting: null,
  locked: null,
  otherOwner: null,
};

const tint = (patch: Partial<GetProxyStateResponse> | null) =>
  statusTintColor(proxyStatusOf(patch == null ? null : { ...base, ...patch }));

const cli: GetProxyStateResponse["otherOwner"] = {
  owner: "cli",
  pid: 42,
  startedAt: "2026-11-10T10:00:00Z",
  proxyPort: 9091,
};

describe("proxyStatusOf and statusTintColor", () => {
  test("recording takes the success colour", () => {
    expect(proxyStatusOf(base)).toBe("recording");
    expect(tint({})).toBe("var(--success)");
  });

  test("paused takes the warning colour", () => {
    expect(proxyStatusOf({ ...base, recording: false })).toBe("paused");
    expect(tint({ recording: false })).toBe("var(--warning)");
  });

  test("not running takes the danger colour", () => {
    expect(proxyStatusOf({ ...base, state: "stopped", port: null })).toBe("stopped");
    expect(tint({ state: "stopped", port: null })).toBe("var(--danger)");
  });

  test("failing to start takes the danger colour", () => {
    expect(tint({ state: "stopped", port: null, startError: "Port 9090 is in use" })).toBe(
      "var(--danger)",
    );
  });

  test("locked traffic takes the danger colour", () => {
    const locked = { message: "Traffic is locked", keychain: true } as NonNullable<
      GetProxyStateResponse["locked"]
    >;
    expect(tint({ state: "stopped", port: null, locked })).toBe("var(--danger)");
  });

  test("an engine the CLI owns takes the info colour", () => {
    expect(proxyStatusOf({ ...base, state: "stopped", port: null, otherOwner: cli })).toBe("cli");
    expect(tint({ state: "stopped", port: null, otherOwner: cli })).toBe("var(--info)");
  });

  test("no tint while encrypting or before the state is read", () => {
    expect(proxyStatusOf({ ...base, state: "stopped", encrypting: 0.4 })).toBe("encrypting");
    expect(tint({ state: "stopped", encrypting: 0.4 })).toBeNull();
    expect(tint(null)).toBeNull();
  });
});
