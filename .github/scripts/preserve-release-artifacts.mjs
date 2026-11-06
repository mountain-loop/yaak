// Retain only distributable bundle files, never the target tree or signing material.
import { createHash } from "node:crypto";
import {
  copyFileSync,
  createReadStream,
  existsSync,
  mkdirSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";

const env = process.env;
const bundle = join("target", env.RELEASE_TARGET || "", "release", "bundle");
const destination = join(env.RUNNER_TEMP, "yaak-release-artifacts");
const extensions =
  /\.(dmg|deb|rpm|AppImage|exe|msi|app\.tar\.gz|AppImage\.tar\.gz|nsis\.zip|msi\.zip)(\.sig)?$/;
const files = [];

function snapshot(directory) {
  if (!existsSync(directory)) return;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const source = join(directory, entry.name);
    // Only descend through the bundler's immediate output folders. This excludes
    // .app trees and the extracted CEF deb contents (which contain executables).
    if (entry.isDirectory() && directory === bundle) {
      snapshot(source);
    } else if (
      entry.isFile() &&
      (extensions.test(entry.name) || /^yaak-cef_.*_linux_.*\.tar\.gz$/.test(entry.name))
    ) {
      // Match tauri-action's default macOS updater asset naming exactly.
      const arch = env.RELEASE_ARCH === "arm64" ? "aarch64" : "x64";
      const assetName = entry.name.replace(/\.app\.tar\.gz(\.sig)?$/, `_${arch}.app.tar.gz$1`);
      mkdirSync(destination, { recursive: true });
      const retained = join(destination, assetName);
      // The second snapshot must not overwrite the original user installer/signature.
      if (!existsSync(retained)) copyFileSync(source, retained);
      files.push({ source: relative(".", source), assetName });
    }
  }
}

snapshot(bundle);
if (existsSync(destination)) {
  const assets = readdirSync(destination)
    .filter((name) => name !== "provenance.json")
    .sort();
  const checksums = [];
  for (const assetName of assets) {
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(join(destination, assetName))) hash.update(chunk);
    checksums.push({ assetName, sha256: hash.digest("hex") });
  }
  writeFileSync(
    join(destination, "provenance.json"),
    JSON.stringify(
      {
        repository: env.GITHUB_REPOSITORY,
        tag: env.GITHUB_REF_NAME,
        sha: env.GITHUB_SHA,
        runId: env.GITHUB_RUN_ID,
        runAttempt: env.GITHUB_RUN_ATTEMPT,
        workflowRef: env.GITHUB_WORKFLOW_REF,
        workflowSha: env.GITHUB_WORKFLOW_SHA,
        tauriAction: "tauri-apps/tauri-action@v0",
        platform: env.RELEASE_PLATFORM,
        runtime: env.RELEASE_RUNTIME,
        arch: env.RELEASE_ARCH,
        target: env.RELEASE_TARGET,
        args: env.RELEASE_ARGS,
        assets: checksums,
      },
      null,
      2,
    ) + "\n",
  );
}
console.log(`Found ${files.length} distributable bundle files in ${bundle}`);
