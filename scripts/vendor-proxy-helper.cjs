/**
 * Builds Yaak Proxy's privileged helper and places it where the proxy bundle's
 * `externalBin` expects it, named for the target triple. The helper is macOS only.
 */

const { execFileSync } = require("node:child_process");
const { chmodSync, copyFileSync, mkdirSync } = require("node:fs");
const path = require("node:path");

if (process.platform !== "darwin") {
  console.log("The proxy helper is macOS only, so there is nothing to vendor");
  process.exit(0);
}

const rootDir = path.join(__dirname, "..");
const destDir = path.join(rootDir, "crates-tauri", "yaak-app-proxy", "vendored", "helper");
const target = process.env.TAURI_ENV_TARGET_TRIPLE || hostTriple();

function hostTriple() {
  const output = execFileSync("rustc", ["-vV"]).toString();
  return output.match(/^host: (\S+)$/m)[1];
}

/** Where Cargo builds, which CARGO_TARGET_DIR or a config's build.target-dir can move */
function targetDir() {
  const args = ["metadata", "--format-version", "1", "--no-deps"];
  return JSON.parse(execFileSync("cargo", args, { cwd: rootDir })).target_directory;
}

function build(triple) {
  execFileSync(
    "cargo",
    ["build", "--package", "yaak-proxy-helper", "--release", "--target", triple],
    { cwd: rootDir, stdio: "inherit" },
  );
  return path.join(targetDir(), triple, "release", "yaak-proxy-helper");
}

mkdirSync(destDir, { recursive: true });
const dest = path.join(destDir, `yaak-proxy-helper-${target}`);
if (target === "universal-apple-darwin") {
  const arm = build("aarch64-apple-darwin");
  const intel = build("x86_64-apple-darwin");
  execFileSync("lipo", ["-create", "-output", dest, arm, intel], { stdio: "inherit" });
} else {
  copyFileSync(build(target), dest);
}
chmodSync(dest, 0o755);
console.log(`Vendored the proxy helper to ${path.relative(rootDir, dest)}`);
