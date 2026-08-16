const fs = require("node:fs");
const path = require("node:path");
const tar = require("tar");
const yauzl = require("yauzl");

// Resolve an archive entry against destDir, refusing anything that escapes it.
function safeJoin(destDir, entryName) {
  const root = path.resolve(destDir);
  const resolved = path.resolve(root, entryName);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error(`Archive entry escapes destination directory: ${entryName}`);
  }
  return resolved;
}

function extractZip(filePath, destDir) {
  return new Promise((resolve, reject) => {
    yauzl.open(filePath, { lazyEntries: true }, (err, zip) => {
      if (err) return reject(err);
      zip.on("error", reject);
      zip.on("end", resolve);
      zip.on("entry", (entry) => {
        let dst;
        try {
          dst = safeJoin(destDir, entry.fileName);
        } catch (e) {
          return reject(e);
        }

        // Unix mode lives in the high 16 bits of the external attributes
        const rawMode = (entry.externalFileAttributes >>> 16) & 0xffff;
        const isSymlink = (rawMode & 0o170000) === 0o120000;
        if (isSymlink) {
          return reject(new Error(`Refusing to extract symlink from archive: ${entry.fileName}`));
        }

        if (entry.fileName.endsWith("/")) {
          fs.mkdirSync(dst, { recursive: true });
          return zip.readEntry();
        }

        zip.openReadStream(entry, (err2, stream) => {
          if (err2) return reject(err2);
          fs.mkdirSync(path.dirname(dst), { recursive: true });
          const out = fs.createWriteStream(dst);
          stream.on("error", reject);
          out.on("error", reject);
          out.on("close", () => {
            const mode = rawMode & 0o7777;
            if (mode !== 0) fs.chmodSync(dst, mode);
            zip.readEntry();
          });
          stream.pipe(out);
        });
      });
      zip.readEntry();
    });
  });
}

/**
 * Extract a `.zip` or `.tar.gz` archive into destDir, preserving file modes.
 * Entries that would land outside destDir are rejected.
 */
async function extractArchive(filePath, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  if (filePath.endsWith(".zip")) {
    await extractZip(filePath, destDir);
  } else if (filePath.endsWith(".tar.gz") || filePath.endsWith(".tgz")) {
    // oxlint-disable-next-line await-thenable -- tar.x() returns a promise when `file` is set
    await tar.x({ file: filePath, cwd: destDir });
  } else {
    throw new Error(`Unsupported archive format: ${path.basename(filePath)}`);
  }
}

module.exports = { extractArchive };
