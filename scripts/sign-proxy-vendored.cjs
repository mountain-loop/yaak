#!/usr/bin/env node

/**
 * Signs the executables Yaak Proxy's bundle takes from Yaak's vendored tools with hardened
 * runtime, as notarization requires of every executable in the app. Runs after vendoring, in
 * the bundle's before-build step, with the identity `scripts/bundle-proxy.mjs` chose. Without
 * one, or off macOS, the bundle is unsigned anyway and this does nothing.
 */

const { execFileSync } = require("child_process");
const { existsSync } = require("fs");
const path = require("path");

const rootDir = path.join(__dirname, "..");
const identity = process.env.APPLE_SIGNING_IDENTITY;

if (process.platform !== "darwin" || !identity) {
  console.log("No signing identity, so the vendored protoc is left unsigned");
  process.exit(0);
}

const clientDir = path.join(rootDir, "crates-tauri", "yaak-app-client");
const protoc = path.join(clientDir, "vendored", "protoc", "yaakprotoc");
const entitlements = path.join(clientDir, "macos", "entitlements.yaakprotoc.plist");

if (!existsSync(protoc)) {
  console.error(`${protoc} is missing: run \`npm run vendor\` first`);
  process.exit(1);
}

execFileSync(
  "codesign",
  ["--force", "--options", "runtime", "--entitlements", entitlements, "--sign", identity, protoc],
  { stdio: "inherit" },
);
console.log(`Signed ${path.relative(rootDir, protoc)}`);
