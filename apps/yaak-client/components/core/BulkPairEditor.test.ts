import { describe, expect, test } from "vite-plus/test";
import { parseBulkPairLine } from "./BulkPairEditor";

describe("parseBulkPairLine", () => {
  test("parses colon-space pairs as name and value", () => {
    expect(parseBulkPairLine("foo: bar")).toMatchObject({
      enabled: true,
      name: "foo",
      value: "bar",
    });
  });

  test("preserves colon-without-space lines as a name with an empty value", () => {
    expect(parseBulkPairLine("foo:bar")).toMatchObject({
      enabled: true,
      name: "foo:bar",
      value: "",
    });
  });

  test("preserves malformed lines instead of dropping their contents", () => {
    expect(parseBulkPairLine("not a pair")).toMatchObject({
      enabled: true,
      name: "not a pair",
      value: "",
    });
  });

  test("unescapes newlines in parsed values", () => {
    expect(parseBulkPairLine("foo: bar\\nbaz")).toMatchObject({
      enabled: true,
      name: "foo",
      value: "bar\nbaz",
    });
  });
});
