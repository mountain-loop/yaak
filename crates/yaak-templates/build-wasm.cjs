const { execSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

if (process.env.SKIP_WASM_BUILD === "1") {
  console.log("Skipping wasm-pack build (SKIP_WASM_BUILD=1)");
  return;
}

execSync("wasm-pack build --target bundler", { stdio: "inherit" });

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
