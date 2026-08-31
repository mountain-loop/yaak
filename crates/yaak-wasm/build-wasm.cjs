const { execSync, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// Same shape as crates/yaak-templates/build-wasm.cjs, plus one wrinkle: this
// crate links SQLite, and sqlite-wasm-rs compiles sqlite3.c to wasm at build
// time. That needs a C compiler with a WebAssembly backend, which Apple's
// clang is not. So the build looks for one, and when it finds none it keeps
// the committed pkg/ and says so — desktop developers never need this crate
// rebuilt, and failing their `npm run bootstrap` over it would be wrong.

if (process.env.SKIP_WASM_BUILD === "1") {
  console.log("Skipping wasm-pack build (SKIP_WASM_BUILD=1)");
  return;
}

/** A clang that can emit wasm32, or null. */
function findWasmClang() {
  const candidates = [
    process.env.CC_wasm32_unknown_unknown,
    "/opt/homebrew/opt/llvm/bin/clang", // Homebrew LLVM, Apple Silicon
    "/usr/local/opt/llvm/bin/clang", // Homebrew LLVM, Intel
    "clang", // Linux distros' clang usually has the backend built in
  ].filter(Boolean);

  for (const clang of candidates) {
    const probe = spawnSync(clang, ["--print-targets"], { encoding: "utf8" });
    if (probe.status === 0 && /\bwasm32\b/.test(probe.stdout)) return clang;
  }
  return null;
}

const clang = findWasmClang();
if (clang == null) {
  console.log(
    [
      "yaak-web: no C compiler with a WebAssembly backend found; keeping the committed pkg/.",
      "  To rebuild: install LLVM (macOS: `brew install llvm`) or point CC_wasm32_unknown_unknown at one.",
    ].join("\n"),
  );
  return;
}

// llvm-ar lives next to clang in every LLVM distribution
const ar = path.join(path.dirname(clang), "llvm-ar");

// Remap machine-specific paths that rustc embeds into the binary (panic
// location strings), so builds are reproducible across machines
const sysroot = execSync("rustc --print sysroot").toString().trim();
const cargoHome = process.env.CARGO_HOME ?? path.join(os.homedir(), ".cargo");

execSync("wasm-pack build --target bundler", {
  stdio: "inherit",
  cwd: __dirname,
  env: {
    ...process.env,
    CC_wasm32_unknown_unknown: clang,
    AR_wasm32_unknown_unknown: fs.existsSync(ar) ? ar : (process.env.AR_wasm32_unknown_unknown ?? ""),
    RUSTFLAGS: `--remap-path-prefix=${cargoHome}=/cargo --remap-path-prefix=${sysroot}=/rustc`,
  },
});

// Rewrite the generated entry to use Vite's ?init import style instead of
// the ES Module Integration style that wasm-pack generates, which Vite/rolldown
// does not support in production builds.
const entry = path.join(__dirname, "pkg", "yaak_web.js");
fs.writeFileSync(
  entry,
  [
    'import init from "./yaak_web_bg.wasm?init";',
    'export * from "./yaak_web_bg.js";',
    'import * as bg from "./yaak_web_bg.js";',
    'const instance = await init({ "./yaak_web_bg.js": bg });',
    "bg.__wbg_set_wasm(instance.exports);",
    "instance.exports.__wbindgen_start();",
    "",
  ].join("\n"),
);
