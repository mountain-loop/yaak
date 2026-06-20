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

  test("keeps non-syntax punctuation bare", () => {
    expect(formatFieldFilter("url", "yaa$&#*@tsrna(*)")).toBe("@url:yaa$&#*@tsrna(*)");
    expect(matchesFormattedUrl("yaa$&#*@tsrna(*)")).toBe(true);
  });

  test("keeps values that start with an operator token bare", () => {
    expect(formatFieldFilter("url", "-foo")).toBe("@url:-foo");
    expect(matchesFormattedUrl("-foo")).toBe(true);
  });

  test("keeps boolean operator words bare", () => {
    expect(formatFieldFilter("url", "AND")).toBe("@url:AND");
    expect(formatFieldFilter("url", "or")).toBe("@url:or");
    expect(formatFieldFilter("url", "Not")).toBe("@url:Not");
    expect(matchesFormattedUrl("AND")).toBe(true);
  });

  test("escapes quoted values", () => {
    expect(formatFieldFilter("url", 'say "hi"')).toBe('@url:"say \\"hi\\""');
    expect(matchesFormattedUrl('say "hi"')).toBe(true);
  });

  test("quotes values that start with a quote", () => {
    expect(formatFieldFilter("url", '"hi"')).toBe('@url:"\\"hi\\""');
    expect(matchesFormattedUrl('"hi"')).toBe(true);
  });
});
