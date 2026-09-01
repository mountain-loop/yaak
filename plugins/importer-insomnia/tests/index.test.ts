import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, test } from "vite-plus/test";
import YAML from "yaml";
import { convertInsomnia } from "../src";

describe("importer-yaak", () => {
  const p = path.join(__dirname, "fixtures");
  const fixtures = fs.readdirSync(p);

  for (const fixture of fixtures) {
    if (fixture.includes(".output")) {
      continue;
    }

    test(`Imports ${fixture}`, () => {
      const contents = fs.readFileSync(path.join(p, fixture), "utf-8");
      const expected = fs.readFileSync(
        path.join(p, fixture.replace(/.input\..*/, ".output.json")),
        "utf-8",
      );
      const result = convertInsomnia(contents);
      // console.log(JSON.stringify(result, null, 2))
      expect(result).toEqual(parseJsonOrYaml(expected));
    });
  }

  test("Keys resources by their Insomnia _id, unchanged by a rename", () => {
    const collection = (requestName: string) =>
      YAML.stringify({
        type: "collection.insomnia.rest/5.0",
        name: "Keys",
        meta: { id: "wrk_1" },
        environments: { meta: { id: "env_1" }, name: "Base", data: {} },
        collection: [
          {
            meta: { id: "fld_1" },
            name: "Folder",
            children: [
              {
                meta: { id: "req_1" },
                name: requestName,
                method: "GET",
                url: "https://yaak.app",
              },
            ],
          },
        ],
      });

    const before = convertInsomnia(collection("Original"));
    const after = convertInsomnia(collection("Renamed"));

    expect(before?.sourceKeys?.[before.resources.httpRequests[0]!.id]).toBe("req_1");
    expect(after?.sourceKeys?.[after.resources.httpRequests[0]!.id]).toBe("req_1");
    expect(before?.sourceKeys?.[before.resources.folders[0]!.id]).toBe("fld_1");
    expect(before?.sourceKeys?.[before.resources.workspaces[0]!.id]).toBe("wrk_1");
  });
});

function parseJsonOrYaml(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return YAML.parse(text);
  }
}
