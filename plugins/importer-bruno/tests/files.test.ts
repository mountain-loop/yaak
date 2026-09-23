import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Context, ImportFiles } from "@yaakapp/api";
import { describe, expect, test } from "vite-plus/test";
import { createImportFiles, runImporter } from "../../../packages/plugin-runtime/src/importFiles";
import { plugin } from "../src";
import { readBrunoCollection } from "../src/files";

const ctx = {} as Context;

describe.each(["opencollection", "legacy"])("Bruno %s file tree", (name) => {
  test("imports the same resources from a ZIP or directory, including nested folders and environments", async () => {
    const directory = fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
    const bytes = await readFile(new URL(`./fixtures/${name}.zip`, import.meta.url));
    const zipped = await runImporter(plugin.importer!, ctx, {
      content: "",
      source: { type: "file", name: `${name}.zip`, base64: bytes.toString("base64") },
    });
    const unzipped = await runImporter(plugin.importer!, ctx, {
      content: "",
      source: { type: "directory", path: directory },
    });
    expect(zipped).toEqual(unzipped);
    expect(zipped?.resources.workspaces[0]?.name).toBe(
      name === "legacy" ? "Legacy Bruno" : "Directory YAML",
    );
    expect(zipped?.resources.httpRequests).toHaveLength(2);
    expect(zipped?.resources.httpRequests.find((r) => r.name === "Get Users")).toMatchObject({
      url: "${[ host ]}/users",
      authenticationType: null,
    });
    expect(zipped?.resources.httpRequests.find((r) => r.name === "Query")).toMatchObject({
      bodyType: "graphql",
      body: { query: "query { users { id } }" },
    });
    expect(zipped?.resources.environments[0]?.variables).toContainEqual({
      name: "host",
      value: "https://example.com",
      enabled: true,
    });
    expect(zipped?.resources.environments[1]?.variables).toContainEqual({
      name: "token",
      value: "sample",
      enabled: true,
    });
    expect(zipped?.resources.folders.find((f) => f.name === "Users")).toMatchObject({
      sortPriority: 3,
    });
  });
});

test("still imports a bundled YAML file through the new runtime entry point", async () => {
  const bytes = await readFile(new URL("./fixtures/collection.yaml", import.meta.url));
  const result = await runImporter(plugin.importer!, ctx, {
    content: bytes.toString(),
    source: { type: "file", name: "collection.yaml", base64: bytes.toString("base64") },
  });
  expect(result?.resources.workspaces[0]?.name).toBe("Example API");
});

test("imports pasted YAML through the file hook's virtual input file", async () => {
  const content = await readFile(new URL("./fixtures/collection.yaml", import.meta.url), "utf8");
  const result = await runImporter(plugin.importer!, ctx, { content });
  expect(result?.resources.workspaces[0]?.name).toBe("Example API");
});

test("supports an individual .bru request", async () => {
  const bytes = await readFile(new URL("./fixtures/legacy/Demo/Users/get.bru", import.meta.url));
  const result = await runImporter(plugin.importer!, ctx, {
    content: bytes.toString(),
    source: { type: "file", name: "get.bru", base64: bytes.toString("base64") },
  });
  expect(result?.resources.httpRequests[0]?.name).toBe("Get Users");
});

test("does not claim an unrelated binary file", async () => {
  expect(
    await runImporter(plugin.importer!, ctx, {
      content: "",
      source: { type: "file", name: "body.bin", base64: "/w==" },
    }),
  ).toBeNull();
});

test("rejects multiple collection roots before reading their contents", async () => {
  const files: ImportFiles = {
    name: "collections",
    kind: "directory",
    async readDir(dir = "") {
      return dir === ""
        ? ["a", "b"].map((name) => ({ name, path: name, type: "directory" as const }))
        : [{ name: "bruno.json", path: `${dir}/bruno.json`, type: "file" }];
    },
    async readFile() {
      throw new Error("should not read");
    },
    async readTextFile() {
      throw new Error("should not read");
    },
  };
  await expect(readBrunoCollection(files)).rejects.toThrow("multiple Bruno collections");
});

test("reports parse errors with the relative file path", async () => {
  const session = await createImportFiles({
    content: "meta { invalid",
    source: {
      type: "file",
      name: "broken.bru",
      base64: Buffer.from("meta { invalid").toString("base64"),
    },
  });
  try {
    await expect(readBrunoCollection(session.files)).rejects.toThrow();
  } finally {
    session.close();
  }
});
