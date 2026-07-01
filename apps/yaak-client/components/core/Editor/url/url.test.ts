import { describe, expect, test } from "vite-plus/test";
import { parser } from "./url";

function expectValidParse(input: string) {
  expect(parser.parse(input).toString()).not.toContain("⚠");
}

function placeholderValues(input: string): string[] {
  const values: string[] = [];
  parser
    .parse(input)
    .cursor()
    .iterate((node) => {
      if (node.name === "Placeholder") values.push(input.slice(node.from, node.to));
    });
  return values;
}

describe("URL grammar Placeholder", () => {
  test("recognizes path placeholders", () => {
    expectValidParse("https://x.com/users/:id");
    expect(placeholderValues("https://x.com/users/:id")).toEqual([":id"]);
  });

  test("treats a colon suffix as literal path text", () => {
    expectValidParse("https://yaak.app/x/echo/:foo:bar/baz");
    expect(placeholderValues("https://yaak.app/x/echo/:foo:bar/baz")).toEqual([":foo"]);
  });

  test("treats repeated colon suffixes as literal path text", () => {
    expectValidParse("https://yaak.app/x/echo/:foo:bar:baz");
    expect(placeholderValues("https://yaak.app/x/echo/:foo:bar:baz")).toEqual([":foo"]);
  });

  test("does not recognize a colon in the middle of a plain path segment", () => {
    expectValidParse("https://yaak.app/x/echo/foo:bar/baz");
    expect(placeholderValues("https://yaak.app/x/echo/foo:bar/baz")).toEqual([]);
  });

  test("does not recognize query parameters as path placeholders", () => {
    expect(placeholderValues("https://yaak.app/x/echo/:foo?bar=ss&:bar=baz")).toEqual([":foo"]);
  });

  test("recognizes placeholders in a path fragment after a templated base URL", () => {
    // Mixed Twig parsing can feed the URL parser only the text after a template tag,
    // as in `${[ URL ]}/x/:foo/:hello`.
    expect(placeholderValues("/x/hi:echo/:foo/:hello?bar=ss&:bar=baz")).toEqual([
      ":foo",
      ":hello",
    ]);
  });
});
