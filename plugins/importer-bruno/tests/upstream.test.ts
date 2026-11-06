import { fileURLToPath } from "node:url";
import type { Context } from "@yaakapp/api";
import { expect, test } from "vite-plus/test";
import { runImporter } from "../../../packages/plugin-runtime/src/importFiles";
import { plugin } from "../src";

// Inputs come unchanged from Bruno, not from this importer's model of its formats.
// See fixtures/upstream/README.md for the pinned revision and original paths.
async function importFixture(name: string) {
  const path = fileURLToPath(new URL(`./fixtures/upstream/${name}`, import.meta.url));
  const result = await runImporter(plugin.importer!, {} as Context, {
    content: "",
    source: { type: "directory", path },
  });
  expect(result).not.toBeNull();
  return result!.resources;
}

test("imports Bruno's .bru migration collection with scoped headers, environments, and JSON body", async () => {
  const resources = await importFixture("bru-migration");
  const [workspace] = resources.workspaces;
  expect(resources.workspaces).toHaveLength(1);
  expect(workspace).toMatchObject({
    name: "migration-test",
    headers: [{ name: "X-Collection-Header", value: "migration-test", enabled: true }],
  });
  expect(workspace?.description).toContain("Migration Test Collection");
  expect(workspace?.description).toContain("collectionVar");
  expect(resources.environments).toHaveLength(3);
  expect(resources.environments.find((e) => e.name === "Local")?.variables).toEqual([
    { name: "host", value: "http://localhost:8081", enabled: true },
  ]);
  expect(resources.environments.find((e) => e.name === "Production")?.variables).toEqual([
    { name: "host", value: "https://api.example.com", enabled: true },
  ]);
  expect(resources.folders).toHaveLength(1);
  const [folder] = resources.folders;
  expect(folder).toMatchObject({
    name: "api",
    folderId: null,
    workspaceId: workspace!.id,
    headers: [{ name: "X-Folder-Header", value: "api-folder", enabled: true }],
  });
  expect(resources.httpRequests).toHaveLength(3);
  const getUsers = resources.httpRequests.find((r) => r.name === "get-users");
  expect(getUsers).toMatchObject({
    folderId: folder!.id,
    method: "GET",
    url: "${[ host ]}/api/echo/json",
    authenticationType: "none",
    headers: [{ name: "Accept", value: "application/json", enabled: true }],
  });
  expect(getUsers?.description).toContain("requestVar");
  expect(getUsers?.description).toContain("res.status");
  expect(resources.httpRequests.find((r) => r.name === "ping")).toMatchObject({
    folderId: null,
    url: "${[ host ]}/ping",
    method: "GET",
    sortPriority: 1,
  });
  const post = resources.httpRequests.find((r) => r.name === "post-json");
  expect(post).toMatchObject({
    folderId: null,
    method: "POST",
    url: "${[ host ]}/api/echo/json",
    sortPriority: 2,
    bodyType: "application/json",
    headers: [{ name: "Content-Type", value: "application/json", enabled: true }],
  });
  expect(JSON.parse(post!.body!.text as string)).toEqual({
    message: "hello from migration test",
  });
});

test("imports Bruno's YAML docs collection without conflating repeated request names", async () => {
  const resources = await importFixture("yaml-docs");
  expect(resources.workspaces).toHaveLength(1);
  expect(resources.workspaces[0]?.name).toBe("ymlcollection");
  expect(resources.folders).toHaveLength(2);
  expect(resources.httpRequests).toHaveLength(4);
  for (const n of [1, 2]) {
    const folder = resources.folders.find((f) => f.name === `folder_${n}`);
    expect(folder).toMatchObject({ folderId: null, sortPriority: n });
    expect(resources.httpRequests.filter((r) => r.folderId === folder!.id)).toEqual([
      expect.objectContaining({
        name: "request_1",
        method: "GET",
        url: `https://api.example.com/folder-${n}/one`,
        sortPriority: 1,
      }),
    ]);
  }
  expect(resources.httpRequests.filter((r) => r.folderId === null)).toEqual([
    expect.objectContaining({
      name: "request_1",
      method: "GET",
      url: "https://api.example.com/one",
      sortPriority: 1,
    }),
    expect.objectContaining({
      name: "request_2",
      method: "GET",
      url: "https://api.example.com/two",
      sortPriority: 2,
    }),
  ]);
  expect(new Set(resources.httpRequests.map((r) => r.id)).size).toBe(4);
});
