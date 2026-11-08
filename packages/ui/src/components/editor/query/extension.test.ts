import { describe, expect, test } from "vite-plus/test";
import { pathsAt } from "./extension";

describe("pathsAt", () => {
  const at = (text: string) => pathsAt(text, text.length);

  test("is the field whose value is being typed, quoted values with spaces too", () => {
    expect(at("@host:api")).toEqual(["host"]);
    expect(at('x @app:"Google C')).toEqual(["app"]);
    expect(at('@app:"Google Chrome" ')).toEqual([]);
    expect(at("@header.content-type:")).toEqual(["header.content-type"]);
  });

  test("is a map's name while its key is typed", () => {
    expect(at("@header.x-")).toEqual(["header"]);
    expect(at("@res.header.")).toEqual(["res.header"]);
  });

  test("is nothing outside a field", () => {
    expect(at("stripe ")).toEqual([]);
    expect(at("")).toEqual([]);
  });
});
