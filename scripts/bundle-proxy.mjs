#!/usr/bin/env node

/**
 * Builds Yaak Proxy as a `.app` with its privileged helper inside, signed when a Developer
 * ID Application identity is in the keychain (or named by APPLE_SIGNING_IDENTITY). The helper
 * only registers from a signed bundle, and only answers an app signed by the same team, so
 * the team is taken from the identity and built into the helper.
 */

import { execFileSync, spawnSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, "..");

/** The first Developer ID Application identity, by hash, since names can repeat */
function findIdentity() {
  try {
    const output = execFileSync("security", ["find-identity", "-v", "-p", "codesigning"]);
    const match = output
      .toString()
      .match(/^\s*\d+\) ([0-9A-F]{40}) "(Developer ID Application: .+ \(([A-Z0-9]{10})\))"$/m);
    return match ? { hash: match[1], name: match[2], team: match[3] } : null;
  } catch {
    return null;
  }
}

const env = { ...process.env };
const args = ["--bundles", "app", "--config", "crates-tauri/yaak-app-proxy/tauri.bundle.conf.json"];

if (env.APPLE_SIGNING_IDENTITY) {
  console.log("Signing with APPLE_SIGNING_IDENTITY");
  const team = env.APPLE_SIGNING_IDENTITY.match(/\(([A-Z0-9]{10})\)$/)?.[1];
  env.YAAK_PROXY_TEAM_ID ??= env.APPLE_TEAM_ID ?? team;
} else {
  const identity = process.platform === "darwin" ? findIdentity() : null;
  if (identity) {
    console.log(`Signing with "${identity.name}"`);
    env.APPLE_SIGNING_IDENTITY = identity.hash;
    env.YAAK_PROXY_TEAM_ID ??= identity.team;
  } else {
    console.warn(
      "No Developer ID Application identity found, so the bundle is unsigned and its helper cannot be registered",
    );
    args.push("--no-sign");
  }
}
if (env.YAAK_PROXY_TEAM_ID == null) delete env.YAAK_PROXY_TEAM_ID;

const result = spawnSync(
  process.execPath,
  [path.join(__dirname, "run-build.mjs"), "proxy", ...args, ...process.argv.slice(2)],
  { cwd: rootDir, stdio: "inherit", env },
);
process.exit(result.status ?? 1);
