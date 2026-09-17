import { EditorState } from "@codemirror/state";
import { jsonc } from "@shopify/lang-jsonc";
import { forceParsing } from "@codemirror/language";
import { describe, expect, test } from "vite-plus/test";
import { jsonPathSegmentsAt, jsonPathToSegments, segmentsToJsonPath } from "./jsonPath";

function stateFor(doc: string): EditorState {
  const state = EditorState.create({ doc, extensions: [jsonc()] });
  // Ensure the whole doc is parsed so resolveInner sees a complete tree.
  forceParsing({ state } as never, doc.length, 5000);
  return state;
}

/** JSONPath produced when the cursor sits just after the first occurrence of `needle`. */
function pathAt(doc: string, needle: string): string {
  const pos = doc.indexOf(needle) + needle.length;
  const segs = jsonPathSegmentsAt(stateFor(doc), pos);
  if (segs == null) throw new Error("no JSON tree");
  return segmentsToJsonPath(segs);
}

/** JSONPath produced when the cursor sits just before the first occurrence of `needle`. */
function pathBefore(doc: string, needle: string): string {
  const pos = doc.indexOf(needle);
  const segs = jsonPathSegmentsAt(stateFor(doc), pos);
  if (segs == null) throw new Error("no JSON tree");
  return segmentsToJsonPath(segs);
}

describe("jsonPathSegmentsAt", () => {
  test("nested object keys", () => {
    const doc = `{ "address": { "geo": { "lat": "-37" } } }`;
    expect(pathAt(doc, `-37`)).toBe(`$.address.geo.lat`);
  });

  test("array element index", () => {
    const doc = `{ "featured": [ { "id": 1 }, { "id": 2 } ] }`;
    expect(pathAt(doc, `2`)).toBe(`$.featured[1].id`);
  });

  test("root array element", () => {
    const doc = `[ { "id": 1 }, { "id": 2 } ]`;
    expect(pathAt(doc, `"id": 2`)).toBe(`$[1].id`);
  });

  test("key containing a dot uses bracket-quote notation", () => {
    const doc = `{ "sort": { "link": { "filter": { "category.id": [ "100" ] } } } }`;
    expect(pathAt(doc, `"100"`)).toBe(`$.sort.link.filter["category.id"][0]`);
  });

  test("cursor on a property name resolves that key", () => {
    const doc = `{ "outer": { "inner": 5 } }`;
    expect(pathAt(doc, `"inner"`)).toBe(`$.outer.inner`);
  });

  test("deeply nested arrays and objects", () => {
    const doc = `{ "a": [ { "b": [ 10, 20, 30 ] } ] }`;
    expect(pathAt(doc, `30`)).toBe(`$.a[0].b[2]`);
  });

  test("root scalar yields the root path", () => {
    expect(pathAt(`"hello"`, `hello`)).toBe(`$`);
  });

  test("caret just before a key still resolves that key", () => {
    // The character to the left is the object's whitespace, not the property.
    const doc = `[\n  {\n    "userId": 1,\n    "body": "x"\n  }\n]`;
    expect(pathBefore(doc, `"body"`)).toBe(`$[0].body`);
  });

  test("caret in a line's indentation resolves that line's member", () => {
    // Caret in the blank indentation of the `title` line (structurally the
    // object's whitespace) reads as being on `title`, not a neighbour.
    const doc = `[\n  {\n    "userId": 1,\n    "id": 1,\n    "title": "x"\n  }\n]`;
    const pos = doc.indexOf(`"title"`) - 2; // two spaces into the title line
    const segs = jsonPathSegmentsAt(stateFor(doc), pos);
    expect(segs == null ? null : segmentsToJsonPath(segs)).toBe(`$[0].title`);
  });

  test("caret at the end of an array element keeps the element index", () => {
    // The caret sits after `}` where the left token is the object's close brace.
    const doc = `[\n  { "id": 1 },\n  { "id": 2 }\n]`;
    const pos = doc.indexOf(`},`) + 1;
    const segs = jsonPathSegmentsAt(stateFor(doc), pos);
    expect(segs == null ? null : segmentsToJsonPath(segs)).toBe(`$[0]`);
  });

  test("non-JSON documents return null", () => {
    const state = EditorState.create({ doc: `<xml/>` });
    expect(jsonPathSegmentsAt(state, 3)).toBeNull();
  });
});

describe("segmentsToJsonPath", () => {
  test("empty segment list is the root", () => {
    expect(segmentsToJsonPath([])).toBe(`$`);
  });

  test("partial path via count", () => {
    const segs = [
      { kind: "key", key: "a" },
      { kind: "index", index: 2 },
      { kind: "key", key: "b" },
    ] as const;
    expect(segmentsToJsonPath([...segs], 2)).toBe(`$.a[2]`);
  });
});

describe("jsonPathToSegments", () => {
  test("round-trips paths built by segmentsToJsonPath", () => {
    for (const path of ["$", "$[0]", "$[0].id", '$.data["user.name"][12]', '$["say \\"hi\\""]']) {
      const segments = jsonPathToSegments(path);
      expect(segments).not.toBeNull();
      expect(segmentsToJsonPath(segments ?? [])).toBe(path);
    }
  });

  test("returns null for paths that don't name a single location", () => {
    for (const path of [
      "$..id",
      "$[*]",
      "$.items[?(@.id)]",
      "$[0:2]",
      "items[0]",
      "$.a b",
      '$["\\q"]',
      '$["unterminated]',
      '$["line\nbreak"]',
      "$[01]",
      "$[9007199254740993]",
      "$.$",
    ]) {
      expect(jsonPathToSegments(path)).toBeNull();
    }
  });
});
