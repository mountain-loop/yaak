import { describe, expect, test } from "vite-plus/test";
import { migrateImport } from "../src";

describe("importer-yaak", () => {
  test("Skips invalid imports", () => {
    expect(migrateImport("not JSON")).toBeUndefined();
    expect(migrateImport("[]")).toBeUndefined();
    expect(migrateImport(JSON.stringify({ resources: {} }))).toBeUndefined();
  });

  test("converts schema 1 to 2", () => {
    const imported = migrateImport(
      JSON.stringify({
        yaakSchema: 1,
        resources: {
          requests: [],
        },
      }),
    );

    expect(imported).toEqual(
      expect.objectContaining({
        resources: {
          httpRequests: [],
        },
      }),
    );
  });
  test("converts schema 2 to 3", () => {
    const imported = migrateImport(
      JSON.stringify({
        yaakSchema: 2,
        resources: {
          environments: [
            {
              id: "e_1",
              workspaceId: "w_1",
              name: "Production",
              variables: [{ name: "E1", value: "E1!" }],
            },
          ],
          workspaces: [
            {
              id: "w_1",
              variables: [{ name: "W1", value: "W1!" }],
            },
          ],
        },
      }),
    );

    expect(imported).toEqual(
      expect.objectContaining({
        resources: {
          workspaces: [
            {
              id: "w_1",
            },
          ],
          environments: [
            {
              id: "e_1",
              workspaceId: "w_1",
              name: "Production",
              variables: [{ name: "E1", value: "E1!" }],
              parentModel: "environment",
              parentId: null,
            },
            {
              id: "GENERATE_ID::base_env_w_1",
              workspaceId: "w_1",
              name: "Global Variables",
              variables: [{ name: "W1", value: "W1!" }],
            },
          ],
        },
      }),
    );
  });

  test("converts schema 4 to 5", () => {
    const imported = migrateImport(
      JSON.stringify({
        yaakSchema: 2,
        resources: {
          environments: [
            {
              id: "e_1",
              workspaceId: "w_1",
              base: false,
              name: "Production",
              variables: [{ name: "E1", value: "E1!" }],
            },
            {
              id: "e_1",
              workspaceId: "w_1",
              base: true,
              name: "Global Variables",
              variables: [{ name: "G1", value: "G1!" }],
            },
          ],
          folders: [
            {
              id: "f_1",
            },
          ],
          workspaces: [
            {
              id: "w_1",
            },
          ],
        },
      }),
    );

    expect(imported).toEqual(
      expect.objectContaining({
        resources: {
          workspaces: [
            {
              id: "w_1",
            },
          ],
          folders: [
            {
              id: "f_1",
            },
          ],
          environments: [
            {
              id: "e_1",
              workspaceId: "w_1",
              name: "Production",
              variables: [{ name: "E1", value: "E1!" }],
              parentModel: "environment",
              parentId: null,
            },
            {
              id: "e_1",
              workspaceId: "w_1",
              name: "Global Variables",
              parentModel: "workspace",
              parentId: null,
              variables: [{ name: "G1", value: "G1!" }],
            },
          ],
        },
      }),
    );
  });

  test("Keys models by their Yaak ID, unchanged by a rename", () => {
    const exported = (requestName: string) =>
      JSON.stringify({
        yaakSchema: 5,
        resources: {
          workspaces: [{ id: "wk_1", model: "workspace", name: "Keys" }],
          httpRequests: [
            {
              id: "rq_1",
              model: "http_request",
              workspaceId: "wk_1",
              name: requestName,
              url: "https://yaak.app",
            },
          ],
        },
      });

    expect(migrateImport(exported("Original"))?.sourceKeys).toEqual({
      wk_1: "wk_1",
      rq_1: "rq_1",
    });
    expect(migrateImport(exported("Renamed"))?.sourceKeys).toEqual({
      wk_1: "wk_1",
      rq_1: "rq_1",
    });
  });
});
