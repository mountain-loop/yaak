import { describe, expect, test } from "vite-plus/test";
import { parser } from "./pairs";

function getNodeNames(input: string): string[] {
  const tree = parser.parse(input);
  const nodes: string[] = [];
  const cursor = tree.cursor();
  do {
    if (cursor.name !== "pairs") {
      nodes.push(cursor.name);
    }
  } while (cursor.next());
  return nodes;
}

describe("pairs grammar", () => {
  test("parses colon-space pairs with a value", () => {
    expect(getNodeNames("foo: bar\n")).toEqual(["Key", "Sep", "Value"]);
  });

  test("does not parse colon-without-space as a value", () => {
    const nodes = getNodeNames("foo:bar\n");

    expect(nodes).not.toContain("Value");
  });
});
