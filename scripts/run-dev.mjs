#!/usr/bin/env node

/**
 * Script to run a Tauri app dev server with dynamic port configuration.
 */

import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, "..");

// Load .env.local if it exists
const envLocalPath = path.join(rootDir, ".env.local");
if (fs.existsSync(envLocalPath)) {
  const envContent = fs.readFileSync(envLocalPath, "utf8");
  const envVars = envContent
    .split("\n")
    .filter((line) => line && !line.startsWith("#"))
    .reduce((acc, line) => {
      const [key, value] = line.split("=");
      if (key && value) {
        acc[key.trim()] = value.trim();
      }
      return acc;
    }, {});

  Object.assign(process.env, envVars);
}

const [appName = "client", ...additionalArgs] = process.argv.slice(2);
const appConfigs = {
  client: {
    appDir: "crates-tauri/yaak-app-client",
    devPortEnv: "YAAK_CLIENT_DEV_PORT",
    fallbackDevPortEnv: "YAAK_DEV_PORT",
    defaultPort: "1420",
    tauriConfig: "tauri.conf.json",
    tauriDevConfig: "tauri.development.conf.json",
  },
  proxy: {
    appDir: "crates-tauri/yaak-app-proxy",
    devPortEnv: "YAAK_PROXY_DEV_PORT",
    fallbackDevPortEnv: null,
    defaultPort: "2420",
    tauriConfig: "tauri.conf.json",
    tauriDevConfig: "tauri.development.conf.json",
  },
};

const appConfig = appConfigs[appName];
if (appConfig == null) {
  console.error(`Unknown Tauri app "${appName}"`);
  process.exit(1);
}

const port =
  process.env[appConfig.devPortEnv] ||
  (appConfig.fallbackDevPortEnv
    ? process.env[appConfig.fallbackDevPortEnv]
    : undefined) ||
  appConfig.defaultPort;
const config = JSON.stringify({
  build: { devUrl: `http://localhost:${port}` },
});

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
      !isInlineJson && !path.isAbsolute(value)
        ? path.join(rootDir, value)
        : value,
    );
    i++;
    continue;
  }
  normalizedAdditionalArgs.push(arg);
}

const args = [
  "dev",
  "--no-watch",
  "--config",
  appConfig.tauriConfig,
  "--config",
  appConfig.tauriDevConfig,
  "--config",
  config,
  ...normalizedAdditionalArgs,
];

// Invoke the tauri CLI JS entry point directly via node to avoid shell escaping issues on Windows
const tauriJs = path.join(
  rootDir,
  "node_modules",
  "@tauri-apps",
  "cli",
  "tauri.js",
);

const result = spawnSync(process.execPath, [tauriJs, ...args], {
  cwd: path.join(rootDir, appConfig.appDir),
  stdio: "inherit",
  env: process.env,
});

process.exit(result.status || 0);
