import { forceParsing } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { jsonc } from "@shopify/lang-jsonc";
import { JSONPath } from "jsonpath-plus";
import { describe, expect, test } from "vite-plus/test";
import {
  jsonPathSegmentsAt,
  jsonPathToSegments,
  segmentsToJsonPath,
} from "../../../apps/yaak-client/components/core/Editor/json/jsonPath";
import { plugin } from "../src";

async function filter(json: unknown, path: string) {
  const result = await plugin.filter!.onFilter({} as never, {
    payload: JSON.stringify(json),
    filter: path,
    mimeType: "application/json",
  });
  expect(result.error).toBeUndefined();
  return JSON.parse(result.content);
}

/** Exercise the caret path and expression the breadcrumb button actually sends. */
function breadcrumb(json: unknown) {
  const doc = JSON.stringify(json, null, 2);
  const state = EditorState.create({ doc, extensions: [jsonc()] });
  forceParsing({ state } as never, doc.length, 5000);
  const segments = jsonPathSegmentsAt(state, doc.indexOf('"needle-value"') + 4);
  expect(segments).not.toBeNull();
  const path = segmentsToJsonPath(segments ?? []);
  expect(jsonPathToSegments(path)).toEqual(segments);
  return path;
}

describe("breadcrumb paths through the real filter plugin", () => {
  test.each([
    "identifier",
    "a.b",
    "space key",
    "",
    'quote"key',
    "single'key",
    "back\\slash",
    "bracket]key",
    "combined\"\\]'key",
    "*",
    "..",
    "$",
    "^",
    "~",
    "a,b",
    "0:2",
    "?(true)",
    "(@.length-1)",
    "@number()",
    "`key",
    "x)]y",
    "x)']y",
    "semi;colon",
    "percent%@%key",
    "line\nbreak\t\u0000",
    "emoji 🤔",
    "lone surrogate \ud800",
    "__proto__",
    "constructor",
  ])("selects the literal key %j, not an operator or expression", async (key) => {
    const json = Object.fromEntries([
      [key, "needle-value"],
      ["decoy", "wrong-value"],
    ]);
    expect(await filter(json, breadcrumb(json))).toEqual(["needle-value"]);
  });

  test("nested unusual keys and arrays round-trip and filter at every crumb", async () => {
    const inner = Object.fromEntries([["inner'\\]", { "": "needle-value" }]]);
    const json = { outer: Object.fromEntries([['quote"key', ["decoy", inner]]]) };
    const path = breadcrumb(json);
    const segments = jsonPathToSegments(path)!;
    expect(await filter(json, path)).toEqual(["needle-value"]);
    expect(await filter(json, segmentsToJsonPath(segments, 4))).toEqual([{ "": "needle-value" }]);
    expect(await filter(json, segmentsToJsonPath(segments, 3))).toEqual([inner]);
    expect(await filter(json, segmentsToJsonPath(segments, 2))).toEqual([["decoy", inner]]);
    expect(await filter(json, segmentsToJsonPath(segments, 1))).toEqual([json.outer]);
    expect(await filter(json, segmentsToJsonPath(segments, 0))).toEqual([json]);
  });

  test("root arrays and quoted numeric object keys remain distinct", async () => {
    const json = ["decoy", { "01": { "1": "needle-value" } }];
    expect(await filter(json, breadcrumb(json))).toEqual(["needle-value"]);
    expect(await filter(json, '$[1]["01"]["missing"]')).toEqual([]);
  });

  test.each([null, false, 0, "", [1, 2], { value: 3 }])(
    "retains the matched value %j",
    async (value) => {
      expect(await filter({ 'quote"key': value }, '$["quote\\\"key"]')).toEqual([value]);
    },
  );

  test("only follows own properties, while allowing actual prototype-named JSON keys", async () => {
    const json = JSON.parse('{"a.b":{"__proto__":{"constructor":"own-value"}}}');
    expect(await filter(json, '$["a.b"].__proto__.constructor')).toEqual(["own-value"]);
    expect(await filter(json, '$["a.b"].constructor')).toEqual([]);
    expect(await filter(json, '$["a.b"].__proto__.toString')).toEqual([]);
    expect(await filter(json, '$["a.b"].__proto__.constructor.__proto__')).toEqual([]);
  });
});

describe("existing JSONPath expressions", () => {
  const json = { items: [{ id: 1 }, { id: 2 }, { id: 3 }], "space key": 4 };
  test.each([
    ["$", [json]],
    ["$.items[1].id", [2]],
    ['$["space key"]', [4]],
    ["$['space key']", [4]],
    ["$.items[*].id", [1, 2, 3]],
    ["$..id", [1, 2, 3]],
    ["$.items[0:2].id", [1, 2]],
    ["$.items[0,2].id", [1, 3]],
    ["$.items[?(@.id > 1)].id", [2, 3]],
    ['$.items[?(@["id"] > 1)].id', [2, 3]],
    ["$.items[(@.length-1)].id", [3]],
    ['$["items"][*].id', [1, 2, 3]],
    ['$["items"].$', [json.items]],
    ["$.missing", []],
  ])("preserves %s", async (path, expected) => {
    expect(await filter(json, path as string)).toEqual(expected);
    expect(await filter(json, path as string)).toEqual(JSONPath({ path: path as string, json }));
  });
});
