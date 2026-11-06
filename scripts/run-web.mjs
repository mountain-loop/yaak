#!/usr/bin/env node

/**
 * Run Yaak in a browser: the client built for the web target, and the server
 * that executes its sends.
 *
 * `YAAK_TARGET=web` is what resolves `@yaakapp-internal/platform` to its browser
 * entry (see apps/yaak-client/vite.config.ts). Setting it in a node script rather
 * than inline in an npm script keeps this working on Windows.
 */

import { spawn, spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, "..");

// The post-checkout hook writes a per-worktree dev port in here, and the client's
// vite config reads YAAK_CLIENT_DEV_PORT from it. Without this, two worktrees both
// try to serve on 1420. (run-dev.mjs reads the same file, but with Object.assign,
// so there an explicit YAAK_CLIENT_DEV_PORT is silently ignored.)
const envLocalPath = path.join(rootDir, ".env.local");
if (fs.existsSync(envLocalPath)) {
  for (const line of fs.readFileSync(envLocalPath, "utf8").split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const [key, value] = line.split("=");
    if (!key || !value) continue;
    // Defaults, not overrides: a variable set on the command line is the more
    // deliberate of the two and has to win, or `PORT=x vp run web:dev` silently
    // lands somewhere else.
    process.env[key.trim()] ??= value.trim();
  }
}

const DIST = "dist/apps/yaak-client";

const [mode] = process.argv.slice(2);

// Invoke the Vite+ CLI JS entry point directly via node, the way run-dev.mjs invokes
// the Tauri CLI. The `.bin/vp` shim is a POSIX script that npm pairs with `vp.cmd` and
// `vp.ps1` on Windows, so spawning it without a shell only works on one platform.
const vp = path.join(rootDir, "node_modules", "vite-plus", "bin", "vp");

const runVite = (args) => [process.execPath, [vp, ...args]];

const env = (extra = {}) => ({ ...process.env, YAAK_TARGET: "web", ...extra });

/** Run a build step to completion. A failure ends the script. */
function run(command, args, extra = {}) {
  const result = spawnSync(command, args, { cwd: rootDir, stdio: "inherit", env: env(extra) });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

/**
 * Run a server until it stops, and take it down when this process is stopped.
 *
 * Servers are started as a direct child rather than through `cargo run`, and
 * signals are forwarded to them, because neither happens by itself: `cargo run`
 * is a wrapper that does not pass a terminating signal on to the binary it
 * spawned, and a child is not killed by its parent exiting. Either one on its
 * own leaves a server holding the port after the terminal that started it has
 * gone, and the next run fails with "address already in use".
 */
function serve(command, args, extra = {}) {
  const child = spawn(command, args, { cwd: rootDir, stdio: "inherit", env: env(extra) });

  const stop = (signal) => child.killed || child.kill(signal);
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(signal, () => stop(signal));
  process.on("exit", () => stop("SIGTERM"));

  child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
  child.on("error", (err) => {
    console.error(`Failed to start ${command}: ${err.message}`);
    process.exit(1);
  });
}

/** Build the server and hand back the binary, so it can be run without a wrapper. */
function buildServer() {
  run("cargo", ["build", "-p", "yaak-web"]);
  const target = process.env.CARGO_TARGET_DIR ?? path.join(rootDir, "target");
  return path.join(target, "debug", "yaak-web");
}

switch (mode) {
  // The app, with hot reload, on one origin: its own `/v1` is passed through to
  // the server `web:dev` starts alongside it. Nothing to build first and one
  // address to open.
  case "dev":
    serve(...runVite(["-C", "apps/yaak-client", "dev", "--force"]));
    break;

  // The send executor behind the dev server, on the port a dev build looks for.
  case "proxy":
    serve(buildServer(), [], {
      // So opening the send server's port in a browser lands on the app instead
      // of an explanation of why the app is not there.
      YAAK_WEB_APP_PORT: process.env.YAAK_CLIENT_DEV_PORT ?? process.env.YAAK_DEV_PORT ?? "1420",
    });
    break;

  case "build":
    run(...runVite(["-C", "apps/yaak-client", "build"]));
    break;

  // One process serving both, the shape the Docker image runs. The build comes
  // first because serving a stale `dist` silently tests the last change but one.
  case "serve": {
    const server = buildServer();
    run(...runVite(["-C", "apps/yaak-client", "build"]));
    serve(server, ["--serve", DIST]);
    break;
  }

  default:
    console.error(`Unknown mode ${JSON.stringify(mode)}; expected dev, proxy, build or serve`);
    process.exit(1);
}
