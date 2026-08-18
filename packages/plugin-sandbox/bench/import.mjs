/**
 * How much slower is an importer inside the sandbox?
 *
 * This is the number the tiered-runtime decision rests on. Template functions
 * and auth signing are small enough that engine speed cannot matter; importing
 * is not. Yaak's OpenAPI importer is first-party JavaScript, not Rust, so a
 * large specification is parsed and walked by whatever engine the runtime uses
 * — QuickJS in a browser tab, V8 on the desktop today. If the gap is large
 * enough to be felt on a real document, importers need a different path before
 * the corpus is ported.
 *
 * Usage:
 *   node packages/plugin-sandbox/bench/import.mjs <spec.json> [iterations]
 */

import { build } from "esbuild";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";
import { bundlePlugin } from "../../../scripts/bundle-sandbox-plugins.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const PLUGIN = "importer-openapi";

const specPath = process.argv[2];
const iterations = Number(process.argv[3] ?? 3);
if (specPath == null) {
  console.error("usage: node bench/import.mjs <spec.json> [iterations]");
  process.exit(1);
}

const spec = readFileSync(specPath, "utf8");
console.log(`Spec: ${specPath} (${(spec.length / 1024 / 1024).toFixed(1)} MB)`);
console.log(`Iterations: ${iterations}\n`);

/** The sandbox host, bundled for Node so this script can drive it directly. */
async function loadHost() {
  // Inside node_modules so the emitted bundle's own imports of the QuickJS
  // variant resolve the way any other module's would.
  const outDir = join(root, "node_modules", ".cache", "yaak-plugin-sandbox");
  mkdirSync(outDir, { recursive: true });
  const outfile = join(outDir, "host.mjs");
  await build({
    entryPoints: [join(root, "packages/plugin-sandbox/src/host/sandbox.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
    outfile,
    // Resolved from the repo at run time, so the wasm variant is the real one.
    external: ["@jitl/*", "quickjs-emscripten-core"],
  });
  return import(pathToFileURL(outfile).href);
}

const ctxStub = { id: "bench", label: null, workspaceId: "wk_bench" };

function stats(times) {
  const sorted = [...times].sort((a, b) => a - b);
  const mean = times.reduce((a, b) => a + b, 0) / times.length;
  return { min: sorted[0], median: sorted[Math.floor(sorted.length / 2)], mean };
}

function report(label, times, resourceCount) {
  const { min, median } = stats(times);
  console.log(
    `${label.padEnd(20)} first ${times[0].toFixed(0).padStart(5)} ms   ` +
      `best ${min.toFixed(0).padStart(5)} ms   ` +
      `median ${median.toFixed(0).padStart(5)} ms   (${resourceCount} requests)`,
  );
  // Every run, because the spread is the point: V8 compiles this workload
  // across the first few passes and QuickJS, which does not compile at all,
  // does not. Quoting one ratio would pick a winner by choosing when to look.
  console.log(`${" ".repeat(20)} runs: ${times.map((t) => t.toFixed(0)).join(", ")} ms`);
  return { first: times[0], best: min };
}

/* --------------------------------- Node ---------------------------------- */

const nodeTimes = [];
let nodeCount = 0;
{
  const { createRequire } = await import("node:module");
  const require = createRequire(join(root, "package.json"));
  const mod = require(join(root, "plugins", PLUGIN, "build", "index.js"));
  const plugin = mod.plugin ?? mod.default;

  for (let i = 0; i < iterations; i++) {
    const started = performance.now();
    const result = await plugin.importer.onImport(ctxStub, { text: spec });
    nodeTimes.push(performance.now() - started);
    nodeCount = result?.resources?.httpRequests?.length ?? 0;
  }
}
const node = report("Node (V8)", nodeTimes, nodeCount);

/* -------------------------------- QuickJS -------------------------------- */

const quickTimes = [];
let quickCount = 0;
{
  const { PluginSandboxHost } = await loadHost();
  const source = await bundlePlugin(PLUGIN);

  const host = new PluginSandboxHost(
    async () => JSON.stringify({ type: "empty_response" }),
    (log) => console.error(`[${log.level}] ${log.message}`),
  );

  const loadStarted = performance.now();
  await host.load(PLUGIN, source);
  console.log(`(sandbox boot + load: ${(performance.now() - loadStarted).toFixed(0)} ms)\n`);

  for (let i = 0; i < iterations; i++) {
    const started = performance.now();
    const reply = JSON.parse(
      await host.dispatch(
        PLUGIN,
        JSON.stringify({ context: ctxStub, payload: { type: "import_request", content: spec } }),
      ),
    );
    quickTimes.push(performance.now() - started);
    if (reply.type === "error_response") throw new Error(reply.error);
    quickCount = reply.resources?.httpRequests?.length ?? 0;
  }
  host.dispose();
}
const quick = report("QuickJS (sandbox)", quickTimes, quickCount);

console.log(
  `\nFirst run (what a user waits for): ${(quick.first / 1000).toFixed(1)}s in the sandbox ` +
    `vs ${(node.first / 1000).toFixed(1)}s in Node — ${(quick.first / node.first).toFixed(1)}x.`,
);
console.log(
  `Best run (both warm): ${(quick.best / node.best).toFixed(1)}x, which is the ceiling once V8 has compiled.`,
);
if (nodeCount !== quickCount) {
  console.log(`WARNING: request counts differ (${nodeCount} vs ${quickCount}) — not the same work.`);
}
