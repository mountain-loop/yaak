import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Context, ImportRequest, ImportSource } from "@yaakapp/api";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { createImportFiles, runImporter } from "./importFiles";

const dirs: string[] = [];
beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
const input = (name: string, data: Uint8Array): ImportRequest => ({
  content: "",
  source: { type: "file", name, base64: Buffer.from(data).toString("base64") },
});
async function zip(name = "import-files.zip") {
  return input(name, await readFile(new URL(`./fixtures/${name}`, import.meta.url)));
}
const ctx = {} as Context;

describe("import file tree", () => {
  test("exposes legacy text and single binary files through the same read API", async () => {
    const session = await createImportFiles({ content: "café" });
    expect(session.text).toBe("café");
    expect(await session.files.readDir()).toEqual([{ name: "input", path: "input", type: "file" }]);
    expect(await session.files.readTextFile("input")).toBe("café");
    session.close();
    await expect(session.files.readFile("input")).rejects.toThrow("closed");
    const binary = await createImportFiles(input("body.bin", Uint8Array.from([255, 0, 128])));
    expect(binary.isText).toBe(false);
    expect([...(await binary.files.readFile("body.bin"))]).toEqual([255, 0, 128]);
    await expect(binary.files.readTextFile("body.bin")).rejects.toThrow();
    binary.close();
  });

  test("lists immediate ZIP children, including implicit/empty directories, and reads binary/UTF-8", async () => {
    const session = await createImportFiles(await zip());
    expect(session.files.kind).toBe("zip");
    expect(session.text).toBe("");
    expect(await session.files.readDir()).toEqual([
      { name: "binary.bin", path: "binary.bin", type: "file" },
      { name: "collection", path: "collection", type: "directory" },
    ]);
    expect((await session.files.readDir("collection")).map((e) => e.name)).toEqual([
      "café.yml",
      "empty",
      "nested",
    ]);
    expect(await session.files.readDir("collection/empty")).toEqual([]);
    expect(await session.files.readTextFile("collection/café.yml")).toBe("name: café\n");
    expect([...(await session.files.readFile("binary.bin"))]).toEqual([0, 255, 128]);
    await expect(session.files.readFile("collection")).rejects.toThrow("not found");
    await expect(session.files.readDir("missing")).rejects.toThrow("not found");
    session.close();
  });

  test("a misleading ZIP suffix still dispatches as text", async () => {
    const content = '{"openapi":"3.0.0","info":{"title":"Example","version":"1"},"paths":{}}';
    const source = input("api.zip", Buffer.from(content));
    const onImport = vi.fn().mockResolvedValue(null);
    await runImporter({ name: "Text", onImport }, ctx, source);
    expect(onImport).toHaveBeenCalledExactlyOnceWith(ctx, { text: content });
    const onImportSource = vi.fn().mockResolvedValue(null);
    await runImporter({ name: "Source", onImportSource }, ctx, source);
    expect(onImportSource).toHaveBeenCalledExactlyOnceWith(ctx, {
      source: { type: "text", name: "api.zip", text: content },
    });
  });

  test("ZIP signatures take precedence over names, including empty archives", async () => {
    const bytes = await readFile(new URL("./fixtures/import-files.zip", import.meta.url));
    const empty = Buffer.alloc(22);
    empty.writeUInt32LE(0x06054b50);
    for (const data of [bytes, empty]) {
      const source = input("collection.yaml", data);
      const session = await createImportFiles(source);
      try {
        expect(session.files.kind).toBe("zip");
        if (data === empty) expect(await session.files.readDir()).toEqual([]);
        else expect(await session.files.readTextFile("collection/café.yml")).toBe("name: café\n");
      } finally {
        session.close();
      }
      const onImport = vi.fn().mockResolvedValue(null);
      expect(await runImporter({ name: "Text", onImport }, ctx, source)).toBeNull();
      expect(onImport).not.toHaveBeenCalled();
    }
  });

  test("a ZIP made by compressing a folder is rooted at that folder", async () => {
    const session = await createImportFiles(await zip("wrapped.zip"));
    try {
      expect((await session.files.readDir()).map((e) => e.name)).toEqual(["nested", "root.txt"]);
      expect(await session.files.readTextFile("nested/file.txt")).toBe("inner\n");
      await expect(session.files.readDir("Demo")).rejects.toThrow("not found");
    } finally {
      session.close();
    }
  });

  test("malformed input with a ZIP signature still fails archive validation", async () => {
    const source = input("broken.zip", Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    await expect(createImportFiles(source)).rejects.toThrow();
  });

  test("directory view reads lazily and blocks links and escaping paths", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "yaak-import-"));
    dirs.push(root);
    await mkdir(path.join(root, "nested"));
    await writeFile(path.join(root, "nested", "file"), "first");
    await symlink(tmpdir(), path.join(root, "escape"));
    const session = await createImportFiles({
      content: "",
      source: { type: "directory", path: root },
    });
    expect(await session.files.readDir()).toEqual([
      { name: "nested", path: "nested", type: "directory" },
    ]);
    await writeFile(path.join(root, "nested", "file"), "updated");
    expect(await session.files.readTextFile("nested/file")).toBe("updated");
    await expect(session.files.readDir("escape")).rejects.toThrow("symbolic");
    for (const p of [
      "../outside",
      "/absolute",
      "C:/outside",
      "nested/../../outside",
      "nested\\file",
    ]) {
      await expect(session.files.readFile(p)).rejects.toThrow();
    }
    session.close();
  });

  test.each(["import-traversal.zip", "import-duplicate.zip", "import-symlink.zip"])(
    "rejects unsafe ZIP %s",
    async (name) => {
      await expect(createImportFiles(await zip(name))).rejects.toThrow();
    },
  );

  test("ZIP entries are decompressed only on read, with a read-size limit", async () => {
    const session = await createImportFiles(await zip("import-large.zip"));
    expect((await session.files.readDir())[0]?.name).toBe("large.txt");
    await expect(session.files.readFile("large.txt")).rejects.toThrow("32 MiB");
    session.close();
  });

  test("the deprecated text hook preserves its arguments and skips other input", async () => {
    const onImport = vi.fn().mockResolvedValue(null);
    const importer = { name: "Legacy", onImport };
    await runImporter(importer, ctx, { content: "original" });
    expect(onImport).toHaveBeenCalledExactlyOnceWith(ctx, { text: "original" });
    onImport.mockClear();
    await runImporter(importer, ctx, input("empty.txt", new Uint8Array()));
    expect(onImport).toHaveBeenCalledExactlyOnceWith(ctx, { text: "" });
    onImport.mockClear();
    for (const source of [
      await zip(),
      input("binary", Uint8Array.from([255])),
      {
        content: "",
        source: { type: "directory", path: "/does-not-exist" },
      } satisfies ImportRequest,
    ]) {
      expect(await runImporter(importer, ctx, source)).toBeNull();
    }
    expect(onImport).not.toHaveBeenCalled();
  });

  test("the source hook gets text for documents and a tree for directories and ZIPs", async () => {
    const onImport = vi.fn().mockResolvedValue(null);
    const onImportSource = vi.fn().mockResolvedValue(null);
    const importer = { name: "Both", onImport, onImportSource };
    const root = await mkdtemp(path.join(tmpdir(), "yaak-import-hooks-"));
    dirs.push(root);
    const cases: [ImportRequest, ImportSource["type"] | null, string?][] = [
      [{ content: "pasted" }, "text", "pasted"],
      [input("text.txt", Buffer.from("text")), "text", "text"],
      [input("empty.txt", new Uint8Array()), "text", ""],
      [input("binary", Uint8Array.from([255])), null],
      [await zip(), "directory"],
      [{ content: "", source: { type: "directory", path: root } }, "directory"],
    ];
    for (const [request, type, text] of cases) {
      onImportSource.mockClear();
      expect(await runImporter(importer, ctx, request)).toBeNull();
      if (type == null) {
        expect(onImportSource).not.toHaveBeenCalled();
        continue;
      }
      expect(onImportSource).toHaveBeenCalledOnce();
      const { source } = onImportSource.mock.calls[0]![1] as { source: ImportSource };
      expect(source.type).toBe(type);
      if (source.type === "text") expect(source.text).toBe(text);
      else await expect(source.files.readDir()).rejects.toThrow("closed");
    }
    onImportSource.mockResolvedValue(undefined);
    await runImporter(importer, ctx, { content: "pasted" });
    expect(onImport).not.toHaveBeenCalled();
    expect(console.warn).not.toHaveBeenCalled();
  });

  test("closes file access even if the importer throws", async () => {
    let saved: import("@yaakapp/api").ImportFiles | undefined;
    await expect(
      runImporter(
        {
          name: "Fails",
          onImportSource(_ctx, { source }) {
            if (source.type === "directory") saved = source.files;
            throw new Error("failure");
          },
        },
        ctx,
        await zip(),
      ),
    ).rejects.toThrow("failure");
    await expect(saved!.readDir()).rejects.toThrow("closed");
  });
});
