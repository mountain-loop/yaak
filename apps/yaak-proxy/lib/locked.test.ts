import { describe, expect, test } from "vite-plus/test";
import { lockedLine } from "./locked";

describe("lockedLine", () => {
  test("points at the platform's key store when it refused", () => {
    const lock = { keychain: true, message: "Traffic is locked: anything" };
    expect(lockedLine(lock, "macos")).toBe(
      "Allow Yaak Proxy to use its key in Keychain Access, then retry.",
    );
    expect(lockedLine(lock, "windows")).toContain("Credential Manager");
    expect(lockedLine(lock, "linux")).toContain("your keyring");
  });

  test("gives any other reason without the title's words", () => {
    const lock = {
      keychain: false,
      message: "Traffic is locked: the proxy is already running in the yaak CLI (pid 4).",
    };
    expect(lockedLine(lock, "macos")).toBe("The proxy is already running in the yaak CLI (pid 4).");
  });
});
