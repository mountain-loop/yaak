import { describe, expect, test } from "vite-plus/test";
import { parser } from "./filter";

function getNodeNames(input: string): string[] {
  const tree = parser.parse(input);
  const nodes: string[] = [];
  const cursor = tree.cursor();
  do {
    if (cursor.name !== "Query") {
      nodes.push(cursor.name);
    }
  } while (cursor.next());
  return nodes;
}

describe("filter grammar", () => {
  test("parses URL-like field values as one value", () => {
    const nodes = getNodeNames("@url:yaak.app/foo-bar");

    expect(nodes).not.toContain("⚠");
    expect(nodes).toContain("FieldValue");
    expect(nodes).toContain("FieldValueWord");
  });

  test("parses punctuation-heavy field values as one value", () => {
    const nodes = getNodeNames("@url:yaa$&#*@tsrna(*)");

    expect(nodes).not.toContain("⚠");
    expect(nodes).toContain("FieldValue");
    expect(nodes).toContain("FieldValueWord");
  });

  test("parses operator-looking field values as one value", () => {
    const negativeValueNodes = getNodeNames("@url:-foo");
    const operatorWordNodes = getNodeNames("@url:AND");

    expect(negativeValueNodes).not.toContain("⚠");
    expect(negativeValueNodes).toContain("FieldValueWord");
    expect(operatorWordNodes).not.toContain("⚠");
    expect(operatorWordNodes).toContain("FieldValueWord");
  });
});
