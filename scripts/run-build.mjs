#!/usr/bin/env node

/**
 * Runs a Tauri app build from the app directory so relative config paths and
 * beforeBuildCommand entries resolve consistently.
 */

import { spawnSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, "..");

const [appName = "client", ...additionalArgs] = process.argv.slice(2);
const appConfigs = {
  client: {
    appDir: "crates-tauri/yaak-app-client",
    tauriConfig: "tauri.conf.json",
  },
  proxy: {
    appDir: "crates-tauri/yaak-app-proxy",
    tauriConfig: "tauri.conf.json",
  },
};

const appConfig = appConfigs[appName];
if (appConfig == null) {
  console.error(`Unknown Tauri app "${appName}"`);
  process.exit(1);
}

// Normalize extra `--config` path args to absolute paths from repo root so
// callers can keep passing root-relative config files.
const normalizedAdditionalArgs = [];
for (let i = 0; i < additionalArgs.length; i++) {
  const arg = additionalArgs[i];
  if (arg === "--config" && i + 1 < additionalArgs.length) {
    const value = additionalArgs[i + 1];
    const isInlineJson = value.trimStart().startsWith("{");
    normalizedAdditionalArgs.push("--config");
    normalizedAdditionalArgs.push(
      !isInlineJson && !path.isAbsolute(value) ? path.join(rootDir, value) : value,
    );
    i++;
    continue;
  }
  normalizedAdditionalArgs.push(arg);
}

const tauriJs = path.join(rootDir, "node_modules", "@tauri-apps", "cli", "tauri.js");
const result = spawnSync(
  process.execPath,
  [tauriJs, "build", "--config", appConfig.tauriConfig, ...normalizedAdditionalArgs],
  {
    cwd: path.join(rootDir, appConfig.appDir),
    stdio: "inherit",
    env: process.env,
  },
);

process.exit(result.status || 0);
