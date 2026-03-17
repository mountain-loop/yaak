const { execSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

if (process.env.SKIP_WASM_BUILD === "1") {
  console.log("Skipping wasm-pack build (SKIP_WASM_BUILD=1)");
  return;
}

const wasmPackVersion = tryExecSync("wasm-pack --version");
if (!wasmPackVersion.startsWith("wasm-pack ")) {
  console.log("wasm-pack is not installed. Installing via cargo...");
  try {
    execSync("cargo install wasm-pack --locked", { stdio: "inherit" });
  } catch (err) {
    // In restricted/offline environments, cargo may be blocked by network policy.
    // If a previously-built pkg already exists, continue without rebuilding wasm.
    if (hasExistingWasmPkg()) {
      console.warn(
        "Skipping wasm-pack build because installation failed, but existing pkg artifacts were found.",
      );
      return;
    }
    throw err;
  }
}

try {
  execSync("wasm-pack build --target bundler", { stdio: "inherit" });
} catch (err) {
  if (hasExistingWasmPkg()) {
    console.warn("Skipping wasm-pack build failure because existing pkg artifacts were found.");
    return;
  }
  throw err;
}

// Rewrite the generated entry to use Vite's ?init import style instead of
// the ES Module Integration style that wasm-pack generates, which Vite/rolldown
// does not support in production builds.
const entry = path.join(__dirname, "pkg", "yaak_templates.js");
fs.writeFileSync(
  entry,
  [
    'import init from "./yaak_templates_bg.wasm?init";',
    'export * from "./yaak_templates_bg.js";',
    'import * as bg from "./yaak_templates_bg.js";',
    'const instance = await init({ "./yaak_templates_bg.js": bg });',
    "bg.__wbg_set_wasm(instance.exports);",
    "instance.exports.__wbindgen_start();",
    "",
  ].join("\n"),
);

function tryExecSync(cmd) {
  try {
    return execSync(cmd, { stdio: "pipe" }).toString("utf-8");
  } catch {
    return "";
  }
}

function hasExistingWasmPkg() {
  return fs.existsSync(path.join(__dirname, "pkg", "yaak_templates_bg.wasm"));
}
