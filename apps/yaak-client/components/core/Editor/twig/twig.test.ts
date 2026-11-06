/* oxlint-disable no-template-curly-in-string */

import { describe, expect, test } from "vite-plus/test";
import { parser } from "./twig";

function getNodeNames(input: string): string[] {
  const tree = parser.parse(input);
  const nodes: string[] = [];
  const cursor = tree.cursor();
  do {
    if (cursor.name !== "Template") {
      nodes.push(cursor.name);
    }
  } while (cursor.next());
  return nodes;
}

function hasTag(input: string): boolean {
  return getNodeNames(input).includes("Tag");
}

function hasError(input: string): boolean {
  return getNodeNames(input).includes("⚠");
}

function countTags(input: string): number {
  return getNodeNames(input).filter((n) => n === "Tag").length;
}

describe("twig grammar", () => {
  describe("${[var]} format (valid template tags)", () => {
    test("parses simple variable as Tag", () => {
      expect(hasTag("${[var]}")).toBe(true);
      expect(hasError("${[var]}")).toBe(false);
    });

    test("parses variable with whitespace as Tag", () => {
      expect(hasTag("${[ var ]}")).toBe(true);
      expect(hasError("${[ var ]}")).toBe(false);
    });

    test("parses embedded variable as Tag", () => {
      expect(hasTag("hello ${[name]} world")).toBe(true);
      expect(hasError("hello ${[name]} world")).toBe(false);
    });

    test("parses function call as Tag", () => {
      expect(hasTag("${[fn()]}")).toBe(true);
      expect(hasError("${[fn()]}")).toBe(false);
    });
  });

  describe("${var} format (should be plain text, not tags)", () => {
    test("parses ${var} as plain Text without errors", () => {
      expect(hasTag("${var}")).toBe(false);
      expect(hasError("${var}")).toBe(false);
    });

    test("parses embedded ${var} as plain Text", () => {
      expect(hasTag("hello ${name} world")).toBe(false);
      expect(hasError("hello ${name} world")).toBe(false);
    });

    test("parses JSON with ${var} as plain Text", () => {
      const json = '{"key": "${value}"}';
      expect(hasTag(json)).toBe(false);
      expect(hasError(json)).toBe(false);
    });

    test("parses multiple ${var} as plain Text", () => {
      expect(hasTag("${a} and ${b}")).toBe(false);
      expect(hasError("${a} and ${b}")).toBe(false);
    });
  });

  describe("mixed content", () => {
    test("distinguishes ${var} from ${[var]} in same string", () => {
      const input = "${plain} and ${[tag]}";
      expect(hasTag(input)).toBe(true);
      expect(hasError(input)).toBe(false);
    });

    test("parses JSON with ${[var]} as having Tag", () => {
      const json = '{"key": "${[value]}"}';
      expect(hasTag(json)).toBe(true);
      expect(hasError(json)).toBe(false);
    });
  });

  describe("quoted strings inside tags", () => {
    test("keeps a quoted `]}` inside the tag", () => {
      const input = "${[ fn(a='x]}y') ]}";
      expect(countTags(input)).toBe(1);
      expect(hasError(input)).toBe(false);
    });

    test("keeps an escaped quote inside the string", () => {
      const input = "${[ fn(a='it\\'s ]}') ]}";
      expect(countTags(input)).toBe(1);
      expect(hasError(input)).toBe(false);
    });

    test("parses a b64 string as one Tag", () => {
      const input = "${[ b64'Zm9v' ]}";
      expect(countTags(input)).toBe(1);
      expect(hasError(input)).toBe(false);
    });

    test("closes at the first `]}` when a quote is left unterminated", () => {
      // Half-typed strings must not swallow the rest of the document
      const input = "${[ fn(a='unterminated ]} after";
      expect(countTags(input)).toBe(1);
      expect(hasError(input)).toBe(false);
      const tag = parser.parse(input).topNode.getChild("Tag");
      expect(input.slice(tag?.from ?? 0, tag?.to ?? 0)).toBe("${[ fn(a='unterminated ]}");
    });

    test("handles two tags with quoted `]}` in the same string", () => {
      const input = "${[ a(x='1]}') ]} and ${[ b(y='2]}') ]}";
      expect(countTags(input)).toBe(2);
      expect(hasError(input)).toBe(false);
    });

    test("keeps JSON around a tag with a quoted `]}` intact", () => {
      const tag = "${[ fn(a='x]}y') ]}";
      const json = '{"a": "' + tag + '"}';
      expect(countTags(json)).toBe(1);
      expect(hasError(json)).toBe(false);
      const node = parser.parse(json).topNode.getChild("Tag");
      expect(json.slice(node?.from ?? 0, node?.to ?? 0)).toBe(tag);
    });
  });

  describe("edge cases", () => {
    test("handles $ at end of string", () => {
      expect(hasError("hello$")).toBe(false);
      expect(hasTag("hello$")).toBe(false);
    });

    test("handles ${ at end of string without crash", () => {
      // Incomplete syntax may produce errors, but should not crash
      expect(() => parser.parse("hello${")).not.toThrow();
    });

    test("handles ${[ without closing without crash", () => {
      // Unclosed tag may produce partial match, but should not crash
      expect(() => parser.parse("${[unclosed")).not.toThrow();
    });

    test("handles empty ${[]}", () => {
      // Empty tags may or may not be valid depending on grammar
      // Just ensure no crash
      expect(() => parser.parse("${[]}")).not.toThrow();
    });
  });
});
