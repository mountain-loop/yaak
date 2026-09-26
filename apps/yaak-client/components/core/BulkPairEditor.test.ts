import { describe, expect, test } from "vite-plus/test";
import {
  formatBulkPairLine,
  formatBulkPairs,
  parseBulkPairLine,
  parseBulkPairs,
} from "./BulkPairEditor";

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

  test("parses commented-out pairs as disabled", () => {
    expect(parseBulkPairLine("# foo: bar")).toMatchObject({
      enabled: false,
      name: "foo",
      value: "bar",
    });
  });

  test("allows any whitespace after the comment marker", () => {
    expect(parseBulkPairLine("#   foo: bar")).toMatchObject({
      enabled: false,
      name: "foo",
      value: "bar",
    });
    expect(parseBulkPairLine("#\tfoo: bar")).toMatchObject({
      enabled: false,
      name: "foo",
      value: "bar",
    });
  });

  test("treats a # without whitespace after it as part of the name", () => {
    expect(parseBulkPairLine("#foo: bar")).toMatchObject({
      enabled: true,
      name: "#foo",
      value: "bar",
    });
  });

  test("parses commented-out pairs with an empty value as disabled", () => {
    expect(parseBulkPairLine("# token:")).toMatchObject({
      enabled: false,
      name: "token",
      value: "",
    });
    expect(parseBulkPairLine("# token: ")).toMatchObject({
      enabled: false,
      name: "token",
      value: "",
    });
  });

  test("drops comments that are not pairs", () => {
    expect(parseBulkPairLine("# just a comment")).toBeNull();
    expect(parseBulkPairLine("# see http://example.com")).toBeNull();
    expect(parseBulkPairLine("#")).toBeNull();
  });

  test("leaves values that start with # alone", () => {
    expect(parseBulkPairLine("color: #fff")).toMatchObject({
      enabled: true,
      name: "color",
      value: "#fff",
    });
  });
});

describe("formatBulkPairLine", () => {
  test("formats enabled pairs as name and value", () => {
    expect(formatBulkPairLine({ enabled: true, name: "foo", value: "bar" })).toBe("foo: bar");
  });

  test("treats pairs without an enabled flag as enabled", () => {
    expect(formatBulkPairLine({ name: "foo", value: "bar" })).toBe("foo: bar");
  });

  test("comments out disabled pairs", () => {
    expect(formatBulkPairLine({ enabled: false, name: "foo", value: "bar" })).toBe("# foo: bar");
  });

  test("escapes newlines in values", () => {
    expect(formatBulkPairLine({ enabled: false, name: "foo", value: "a\nb" })).toBe("# foo: a\\nb");
  });
});

describe("bulk pair round trip", () => {
  test("preserves order and enabled state", () => {
    const pairs = [
      { enabled: true, name: "host", value: "example.com" },
      { enabled: false, name: "token", value: "old" },
      { enabled: true, name: "color", value: "#fff" },
      { enabled: false, name: "multi", value: "a\nb" },
      { enabled: true, name: "token", value: "new" },
    ];

    const text = formatBulkPairs(pairs);
    expect(text).toBe(
      ["host: example.com", "# token: old", "color: #fff", "# multi: a\\nb", "token: new"].join(
        "\n",
      ),
    );

    const parsed = parseBulkPairs(text);
    expect(parsed.map(({ enabled, name, value }) => ({ enabled, name, value }))).toEqual(pairs);
  });

  test("preserves enabled pairs whose name starts with #", () => {
    const pairs = [{ enabled: true, name: "#foo", value: "bar" }];
    const text = formatBulkPairs(pairs);
    expect(text).toBe("#foo: bar");
    const parsed = parseBulkPairs(text);
    expect(parsed.map(({ enabled, name, value }) => ({ enabled, name, value }))).toEqual(pairs);
  });

  test("preserves disabled pairs whose name starts with #", () => {
    const pairs = [{ enabled: false, name: "#foo", value: "bar" }];
    const text = formatBulkPairs(pairs);
    expect(text).toBe("# #foo: bar");
    const parsed = parseBulkPairs(text);
    expect(parsed.map(({ enabled, name, value }) => ({ enabled, name, value }))).toEqual(pairs);
  });

  test("preserves disabled pairs with empty values", () => {
    const pairs = [{ enabled: false, name: "token", value: "" }];
    const parsed = parseBulkPairs(formatBulkPairs(pairs));
    expect(parsed.map(({ enabled, name, value }) => ({ enabled, name, value }))).toEqual(pairs);
  });

  test("drops free-text comments and blank lines between pairs", () => {
    const parsed = parseBulkPairs("# Auth\nfoo: bar\n\n# baz: qux\n# see the docs");
    expect(parsed.map(({ enabled, name, value }) => ({ enabled, name, value }))).toEqual([
      { enabled: true, name: "foo", value: "bar" },
      { enabled: false, name: "baz", value: "qux" },
    ]);
  });
});
