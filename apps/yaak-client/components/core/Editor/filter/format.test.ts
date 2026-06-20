import { describe, expect, test } from "vite-plus/test";
import { formatFieldFilter } from "./format";
import { evaluate, parseQuery } from "./query";

function matchesFormattedUrl(value: string) {
  return evaluate(parseQuery(formatFieldFilter("url", value)), {
    fields: { url: value },
  });
}

describe("formatFieldFilter", () => {
  test("keeps URL-like values bare", () => {
    expect(formatFieldFilter("url", "yaak.app/foo-bar")).toBe("@url:yaak.app/foo-bar");
    expect(matchesFormattedUrl("yaak.app/foo-bar")).toBe(true);
  });

  test("quotes values that start with an operator token", () => {
    expect(formatFieldFilter("url", "-foo")).toBe('@url:"-foo"');
    expect(matchesFormattedUrl("-foo")).toBe(true);
  });

  test("quotes boolean operator words", () => {
    expect(formatFieldFilter("url", "AND")).toBe('@url:"AND"');
    expect(formatFieldFilter("url", "or")).toBe('@url:"or"');
    expect(formatFieldFilter("url", "Not")).toBe('@url:"Not"');
    expect(matchesFormattedUrl("AND")).toBe(true);
  });

  test("escapes quoted values", () => {
    expect(formatFieldFilter("url", 'say "hi"')).toBe('@url:"say \\"hi\\""');
    expect(matchesFormattedUrl('say "hi"')).toBe(true);
  });
});
