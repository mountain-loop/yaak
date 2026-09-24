import { constants } from "node:fs";
import { lstat, open, opendir, realpath } from "node:fs/promises";
import path from "node:path";
import type { Context, ImportFileEntry, ImportFiles, ImportRequest } from "@yaakapp/api";
import type { ImporterPlugin, ImportSource } from "@yaakapp/api/lib/plugins/ImporterPlugin";
import { type Entry, fromBuffer, type ZipFile } from "yauzl";

const MAX_FILE_BYTES = 32 * 1024 * 1024;
const MAX_SOURCE_BYTES = 64 * 1024 * 1024;
const MAX_ENTRIES = 10_000;
const MAX_EXPANDED_BYTES = 256 * 1024 * 1024;

function relativePath(value: string): string {
  if (
    value.includes("\\") ||
    value.includes("\0") ||
    value.startsWith("/") ||
    /^[a-z]:/i.test(value)
  ) {
    throw new Error(`Invalid import path: ${value}`);
  }
  const parts = value.split("/");
  if (parts.includes("..")) throw new Error("Import paths cannot leave the selected source");
  return parts.filter((p) => p !== "" && p !== ".").join("/");
}

function isZip(bytes: Buffer): boolean {
  // Names are hints only: a text specification can legitimately be named *.zip.
  return (
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    ((bytes[2] === 3 && bytes[3] === 4) ||
      (bytes[2] === 5 && bytes[3] === 6) ||
      (bytes[2] === 7 && bytes[3] === 8))
  );
}

export interface ImportFileSession {
  files: ImportFiles;
  kind: "file" | ImportFiles["kind"];
  name: string;
  text: string;
  /** Whether text-only plugins can handle this input, including an empty text file. */
  isText: boolean;
  close(): void;
}

/** Construct one scoped view for one invocation. No ZIP entries are extracted to disk. */
export async function createImportFiles(input: ImportRequest): Promise<ImportFileSession> {
  let closed = false;
  let zip: ZipFile | undefined;
  let zipError: Error | undefined;
  const assertOpen = () => {
    if (closed) throw new Error("Import source is closed");
    if (zipError) throw zipError;
  };
  let kind: ImportFileSession["kind"] = "file";
  let name = "input";
  let text = input.content;
  let isText = true;
  let readDir: ImportFiles["readDir"];
  let readFile: ImportFiles["readFile"];

  if (input.source?.type === "directory") {
    kind = "directory";
    isText = false;
    text = "";
    const root = await realpath(input.source.path);
    name = path.basename(root);
    const resolve = async (value: string) => {
      assertOpen();
      const rel = relativePath(value);
      let candidate = root;
      // Reject links visible during validation, including intermediate components.
      // These path checks are not atomic with open/opendir: concurrent filesystem
      // changes can redirect a later operation. This is not a confinement boundary.
      for (const component of rel.split("/").filter(Boolean)) {
        candidate = path.join(candidate, component);
        if ((await lstat(candidate)).isSymbolicLink())
          throw new Error("Import sources do not follow symbolic links");
      }
      const canonical = await realpath(candidate);
      const within = path.relative(root, canonical);
      if (within === ".." || within.startsWith(`..${path.sep}`) || path.isAbsolute(within))
        throw new Error("Import path is outside the selected source");
      return canonical;
    };
    readDir = async (value = "") => {
      const rel = relativePath(value);
      const entries: ImportFileEntry[] = [];
      for await (const entry of await opendir(await resolve(rel))) {
        if (!entry.isFile() && !entry.isDirectory()) continue;
        entries.push({
          name: entry.name,
          path: rel ? `${rel}/${entry.name}` : entry.name,
          type: entry.isDirectory() ? "directory" : "file",
        });
        if (entries.length > MAX_ENTRIES)
          throw new Error("Import directory contains too many entries");
      }
      assertOpen();
      return entries.sort((a, b) => a.path.localeCompare(b.path));
    };
    readFile = async (value) => {
      const handle = await open(
        await resolve(value),
        constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
      );
      try {
        const stat = await handle.stat();
        if (!stat.isFile()) throw new Error("Import path is not a regular file");
        if (stat.size > MAX_FILE_BYTES)
          throw new Error("Import file exceeds the 32 MiB read limit");
        const chunks: Buffer[] = [];
        let total = 0;
        for await (const chunk of handle.createReadStream({ autoClose: false })) {
          const bytes = Buffer.from(chunk as Uint8Array);
          total += bytes.length;
          if (total > MAX_FILE_BYTES) throw new Error("Import file exceeds the 32 MiB read limit");
          chunks.push(bytes);
        }
        assertOpen();
        return Buffer.concat(chunks);
      } finally {
        await handle.close();
      }
    };
  } else {
    const source = input.source;
    if (source && source.base64.length > Math.ceil(MAX_SOURCE_BYTES / 3) * 4)
      throw new Error("Import source exceeds the 64 MiB limit");
    const bytes = source ? Buffer.from(source.base64, "base64") : Buffer.from(input.content);
    name = source?.name || "input";
    if (bytes.length > MAX_SOURCE_BYTES) throw new Error("Import source exceeds the 64 MiB limit");
    const entries = new Map<string, { type: "file" | "directory"; entry?: Entry; data?: Buffer }>([
      ["", { type: "directory" }],
    ]);
    if (source && isZip(bytes)) {
      kind = "zip";
      text = "";
      isText = false;
      zip = await new Promise<ZipFile>((resolve, reject) => {
        fromBuffer(
          bytes,
          { lazyEntries: true, autoClose: false, strictFileNames: false, validateEntrySizes: true },
          (err, result) => (err ? reject(err) : resolve(result)),
        );
      });
      zip.on("error", (err: Error) => {
        zipError = err;
      });
      const archive = zip;
      try {
        await new Promise<void>((resolve, reject) => {
          let count = 0;
          let expandedBytes = 0;
          archive.once("error", reject);
          archive.once("end", () => {
            archive.removeListener("error", reject);
            resolve();
          });
          archive.on("entry", (entry: Entry) => {
            try {
              if (++count > MAX_ENTRIES) throw new Error("ZIP contains too many entries");
              expandedBytes += entry.uncompressedSize;
              if (expandedBytes > MAX_EXPANDED_BYTES)
                throw new Error("ZIP expanded size exceeds the 256 MiB limit");
              if (entry.isEncrypted()) throw new Error("Encrypted ZIP entries are not supported");
              const mode = (entry.externalFileAttributes >>> 16) & 0xf000;
              if (mode === 0xa000) throw new Error("ZIP symbolic links are not supported");
              const entryPath = relativePath(entry.fileName);
              if (!entryPath) throw new Error("ZIP contains an empty entry path");
              const type = entry.fileName.endsWith("/") ? "directory" : "file";
              const previous = entries.get(entryPath);
              if (previous && (type !== "directory" || previous.type !== "directory"))
                throw new Error(`Duplicate ZIP path: ${entryPath}`);
              entries.set(entryPath, { type, entry });
              let parent = path.posix.dirname(entryPath);
              while (parent !== ".") {
                if (entries.get(parent)?.type === "file")
                  throw new Error(`ZIP file/directory conflict: ${parent}`);
                if (!entries.has(parent)) entries.set(parent, { type: "directory" });
                parent = path.posix.dirname(parent);
              }
              if (entries.size > MAX_ENTRIES) throw new Error("ZIP contains too many paths");
              archive.readEntry();
            } catch (err) {
              reject(err);
            }
          });
          archive.readEntry();
        });
      } catch (err) {
        archive.close();
        throw err;
      }
    } else {
      const entryPath = relativePath(name);
      if (!entryPath || entryPath.includes("/"))
        throw new Error("Single import files must have a basename");
      entries.set(entryPath, { type: "file", data: bytes });
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        text = "";
        isText = false;
      }
    }
    readDir = async (value = "") => {
      assertOpen();
      const rel = relativePath(value);
      if (entries.get(rel)?.type !== "directory")
        throw new Error(`Import directory not found: ${rel}`);
      return [...entries]
        .filter(
          ([p]) => p !== "" && (path.posix.dirname(p) === "." ? "" : path.posix.dirname(p)) === rel,
        )
        .map(([p, entry]) => ({ name: path.posix.basename(p), path: p, type: entry.type }))
        .sort((a, b) => a.path.localeCompare(b.path));
    };
    readFile = async (value) => {
      assertOpen();
      const found = entries.get(relativePath(value));
      if (!found || found.type !== "file") throw new Error(`Import file not found: ${value}`);
      if (found.data) {
        if (found.data.length > MAX_FILE_BYTES)
          throw new Error("Import file exceeds the 32 MiB read limit");
        return Buffer.from(found.data);
      }
      const entry = found.entry!;
      if (entry.uncompressedSize > MAX_FILE_BYTES)
        throw new Error("Import file exceeds the 32 MiB read limit");
      const stream = await new Promise<import("node:stream").Readable>((resolve, reject) => {
        zip!.openReadStream(entry, (err, result) => (err ? reject(err) : resolve(result)));
      });
      const chunks: Buffer[] = [];
      let total = 0;
      for await (const chunk of stream) {
        const bytes = Buffer.from(chunk as Uint8Array);
        total += bytes.length;
        if (total > MAX_FILE_BYTES) {
          stream.destroy();
          throw new Error("Import file exceeds the 32 MiB read limit");
        }
        chunks.push(bytes);
      }
      assertOpen();
      return Buffer.concat(chunks);
    };
  }
  return {
    text,
    isText,
    kind,
    name,
    files: {
      // A lone file is only ever handed to plugins as text, never as a tree
      kind: kind === "file" ? "directory" : kind,
      name,
      readDir,
      readFile,
      async readTextFile(value) {
        return new TextDecoder("utf-8", { fatal: true }).decode(await readFile(value));
      },
    },
    close() {
      closed = true;
      zip?.close();
    },
  };
}

/** Keep legacy text plugins out of directories, archives, and arbitrary binary inputs. */
export async function runImporter(importer: ImporterPlugin, ctx: Context, input: ImportRequest) {
  if (!importer.onImportSource && input.source?.type === "directory") return null;
  // Avoid opening archives once for every legacy importer.
  if (!importer.onImportSource && input.source?.type === "file") {
    const bytes = Buffer.from(input.source.base64, "base64");
    if (isZip(bytes)) return null;
  }
  const session = await createImportFiles(input);
  try {
    if (importer.onImportSource) {
      const source: ImportSource | null =
        session.kind === "file"
          ? session.isText
            ? { type: "text", name: session.name, text: session.text }
            : null
          : { type: "directory", files: session.files };
      if (source == null) return null;
      return await importer.onImportSource(ctx, { source });
    }
    if (session.isText && importer.onImport) {
      return await importer.onImport(ctx, { text: session.text });
    }
    return null;
  } finally {
    session.close();
  }
}
