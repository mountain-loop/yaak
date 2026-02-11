#!/usr/bin/env node

// Adds missing `resolved` and `integrity` fields to npm package-lock.json.
//
// npm sometimes omits these fields for nested dependencies inside workspace
// packages. This breaks offline installs and tools like flatpak-node-generator
// that need explicit tarball URLs for every package.
//
// Based on https://github.com/grant-dennison/npm-package-lock-add-resolved
// (MIT License, Copyright (c) 2024 Grant Dennison)

import { readFile, writeFile } from "node:fs/promises";
import { get } from "node:https";

const lockfilePath = process.argv[2] || "package-lock.json";

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    get(url, (res) => {
      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        if (res.statusCode === 200) {
          resolve(JSON.parse(data));
        } else {
          reject(`${url} returned ${res.statusCode} ${res.statusMessage}`);
        }
      });
      res.on("error", reject);
    }).on("error", reject);
  });
}

async function fillResolved(name, p) {
  const version = p.version.replace(/^.*@/, "");
  console.log(`Retrieving metadata for ${name}@${version}`);
  const metadataUrl = `https://registry.npmjs.com/${name}/${version}`;
  const metadata = await fetchJson(metadataUrl);
  p.resolved = metadata.dist.tarball;
  p.integrity = metadata.dist.integrity;
}

let changesMade = false;

async function fillAllResolved(packages) {
  for (const packagePath in packages) {
    if (packagePath === "") continue;
    if (!packagePath.includes("node_modules/")) continue;
    const p = packages[packagePath];
    if (p.link) continue;
    if (!p.inBundle && !p.bundled && (!p.resolved || !p.integrity)) {
      const packageName =
        p.name ||
        /^npm:(.+?)@.+$/.exec(p.version)?.[1] ||
        packagePath.replace(/^.*node_modules\/(?=.+?$)/, "");
      await fillResolved(packageName, p);
      changesMade = true;
    }
  }
}

const oldContents = await readFile(lockfilePath, "utf-8");
const packageLock = JSON.parse(oldContents);

await fillAllResolved(packageLock.packages ?? []);

if (changesMade) {
  const newContents = JSON.stringify(packageLock, null, 2) + "\n";
  await writeFile(lockfilePath, newContents);
  console.log(`Updated ${lockfilePath}`);
} else {
  console.log("No changes needed.");
}
