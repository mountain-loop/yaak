import { describe, expect, test } from "vite-plus/test";
import { parser } from "./url";

function placeholderStarts(input: string): number[] {
  const positions: number[] = [];
  parser
    .parse(input)
    .cursor()
    .iterate((node) => {
      if (node.name === "Placeholder") positions.push(node.from);
    });
  return positions;
}

describe("URL grammar Placeholder", () => {
  test("recognized after `/`", () => {
    const url = "https://x.com/users/:id";
    const [pos] = placeholderStarts(url);
    expect(url[pos - 1]).toBe("/");
  });

  test("lexer over-emits a second Placeholder after a literal `:` (filter relies on this)", () => {
    const url = "https://x.com/x/:id:def";
    const positions = placeholderStarts(url);
    expect(positions.length).toBe(2);
    expect(url[positions[0] - 1]).toBe("/");
    expect(url[positions[1] - 1]).not.toBe("/");
  });

  test("first segment of a path-only URL is a Placeholder, not eaten as Host", () => {
    // Regression: without `Host?`, the first `:chip1` would be tokenized as Host
    // (Host's char class includes `:` for `host:port`), leaving only `:chip2` as
    // a Placeholder.
    const url = "/:chip1/:chip2";
    const positions = placeholderStarts(url);
    expect(positions.length).toBe(2);
    expect(url.slice(positions[0])).toMatch(/^:chip1/);
  });
});
