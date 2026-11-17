import { describe, expect, test } from "vite-plus/test";
import type { Completion } from "@yaakapp-internal/query";
import { fieldReferences, pathsAt } from "./extension";

describe("fieldReferences", () => {
  const item = (insert: string, kind: Completion["kind"] = "field"): Completion => ({
    label: insert,
    insert,
    kind,
    info: null,
    example: null,
    reopen: true,
  });
  const refs = (items: Completion[]) => fieldReferences(items).map((i) => [i.insert, i.reopen]);

  test("ends a field or a map's key with no colon, and does not open again", () => {
    expect(refs([item("@req.header.user-agent:"), item("@host:")])).toEqual([
      ["@req.header.user-agent", false],
      ["@host", false],
    ]);
  });

  test("opens again after a map, for its key", () => {
    expect(refs([item("@header.")])).toEqual([["@header.", true]]);
  });

  test("never offers values", () => {
    expect(refs([item("Mozilla/5.0", "value"), item("@query.")])).toEqual([["@query.", true]]);
  });
});

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
