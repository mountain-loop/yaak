#!/usr/bin/env node

/**
 * Signs the executables Yaak Proxy's bundle takes from outside its own build with hardened
 * runtime, as notarization requires of every executable in the app: the privileged helper,
 * which `scripts/vendor-proxy-helper.cjs` built for this target, and the `yaakprotoc` from
 * Yaak's vendored tools. Runs after vendoring, in the bundle's before-build step, with the
 * identity `scripts/bundle-proxy.mjs` chose. Without one, or off macOS, the bundle is unsigned
 * anyway and this does nothing.
 */

const { execFileSync } = require("child_process");
const { existsSync, readdirSync } = require("fs");
const path = require("path");

const rootDir = path.join(__dirname, "..");
const identity = process.env.APPLE_SIGNING_IDENTITY;

if (process.platform !== "darwin" || !identity) {
  console.log("No signing identity, so the vendored helper and protoc are left unsigned");
  process.exit(0);
}

// A secure timestamp, as notarization requires; an ad-hoc (`-`) local build can't have one
const timestamp = identity === "-" ? [] : ["--timestamp"];

function sign(file, extraArgs) {
  execFileSync(
    "codesign",
    ["--force", "--options", "runtime", ...timestamp, ...extraArgs, "--sign", identity, file],
    { stdio: "inherit" },
  );
  console.log(`Signed ${path.relative(rootDir, file)}`);
}

// The helper, under the launchd label it runs as
const helperDir = path.join(rootDir, "crates-tauri", "yaak-app-proxy", "vendored", "helper");
const helpers = existsSync(helperDir)
  ? readdirSync(helperDir).filter((name) => name.startsWith("yaak-proxy-helper-"))
  : [];
if (helpers.length === 0) {
  console.error(`No helper in ${helperDir}: run \`npm run proxy:vendor-helper\` first`);
  process.exit(1);
}
for (const name of helpers) {
  sign(path.join(helperDir, name), ["--identifier", "app.yaak.proxy.helper"]);
}

const clientDir = path.join(rootDir, "crates-tauri", "yaak-app-client");
const protoc = path.join(clientDir, "vendored", "protoc", "yaakprotoc");
const entitlements = path.join(clientDir, "macos", "entitlements.yaakprotoc.plist");

if (!existsSync(protoc)) {
  console.error(`${protoc} is missing: run \`npm run vendor\` first`);
  process.exit(1);
}

sign(protoc, ["--entitlements", entitlements]);
