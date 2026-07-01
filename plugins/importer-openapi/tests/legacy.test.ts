import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, test } from "vite-plus/test";
import { convertOpenApiWithPostman } from "../src/legacy";

describe("importer-openapi legacy converter", () => {
  const realWorldFixturesPath = path.join(__dirname, "fixtures", "real-world");
  const realWorldFixtures = fs
    .readdirSync(realWorldFixturesPath)
    .filter((fixture) => fixture.endsWith(".yaml"));

  for (const fixture of realWorldFixtures) {
    test(`Snapshots legacy Postman-converter output for ${fixture}`, async () => {
      const contents = fs.readFileSync(path.join(realWorldFixturesPath, fixture), "utf-8");
      const imported = await convertOpenApiWithPostman(contents);
      expect(imported).toMatchSnapshot();
    });
  }
});
