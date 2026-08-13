import { EditorState } from "@codemirror/state";
import { jsonc } from "@shopify/lang-jsonc";
import { text } from "./text/extension";
import { describe, expect, test, vi } from "vite-plus/test";
import {
  COLLAPSE_TOKEN_CHARS,
  largeValueField,
  largeValues,
  MAX_VISIBLE_LINE_CHARS,
} from "./largeValues";

vi.mock("../../LargeValueDialog", () => ({ LargeValueDialog: { show: () => {} } }));

const BIG = "A".repeat(1_000_000);

/** With a grammar, so tokens can be collapsed individually */
const jsonState = (doc: string) => EditorState.create({ doc, extensions: [jsonc(), largeValues] });

/** Without a grammar, so only the column rule applies */
const plainState = (doc: string) => EditorState.create({ doc, extensions: largeValues });

function collapsedRanges(state: EditorState) {
  const ranges: { from: number; to: number }[] = [];
  const iter = state.field(largeValueField).decorations.iter();
  while (iter.value != null) {
    ranges.push({ from: iter.from, to: iter.to });
    iter.next();
  }
  return ranges;
}

/** How much of each line is still rendered */
function visibleLineLengths(state: EditorState) {
  const hidden = collapsedRanges(state);
  const lengths: number[] = [];
  for (let n = 1; n <= state.doc.lines; n++) {
    const line = state.doc.line(n);
    const covered = hidden
      .filter((h) => h.from >= line.from && h.to <= line.to)
      .reduce((sum, h) => sum + (h.to - h.from), 0);
    lengths.push(line.length - covered);
  }
  return lengths;
}

describe("collapsing", () => {
  test("leaves an ordinary body alone", () => {
    expect(collapsedRanges(jsonState('{"hello":"world"}'))).toEqual([]);
  });

  test("leaves a large body of short lines alone", () => {
    const doc = Array.from({ length: 20_000 }, (_, i) => `  { "id": ${i} },`).join("\n");
    expect(doc.length).toBeGreaterThan(MAX_VISIBLE_LINE_CHARS);
    expect(collapsedRanges(jsonState(doc))).toEqual([]);
  });

  test("leaves a line just under the column limit alone", () => {
    expect(collapsedRanges(plainState("x".repeat(MAX_VISIBLE_LINE_CHARS)))).toEqual([]);
  });

  test("never renders more than the column limit per line", () => {
    for (const state of [jsonState(`{"image":"${BIG}"}`), plainState(BIG)]) {
      for (const length of visibleLineLengths(state)) {
        expect(length).toBeLessThanOrEqual(MAX_VISIBLE_LINE_CHARS);
      }
    }
  });

  test("keeps the document text intact", () => {
    const doc = `{"image":"${BIG}"}`;
    expect(jsonState(doc).sliceDoc()).toBe(doc);
    expect(jsonState(doc).doc.length).toBe(doc.length);
  });
});

describe("token collapsing, with a grammar", () => {
  test("hides the whole value, leaving its quotes visible", () => {
    const doc = `{"name":"a.png","image":"${BIG}","size":12}`;
    const state = jsonState(doc);
    const ranges = collapsedRanges(state);

    expect(ranges).toHaveLength(1);
    // Exactly the text between the quotes, so the line reads as `"image":"<tag>"`
    expect(state.sliceDoc(ranges[0]!.from, ranges[0]!.to)).toBe(BIG);
    expect(doc[ranges[0]!.from - 1]).toBe('"');
    expect(doc[ranges[0]!.to]).toBe('"');

    // Everything after the value is still rendered, unlike a plain column cut
    expect(doc.slice(ranges[0]!.to)).toContain('"size":12}');
  });

  test("keeps every key visible in a minified body with several large values", () => {
    const chunk = "B".repeat(200_000);
    const doc = `{${["a", "b", "c", "d", "e"].map((k) => `"${k}":"${chunk}"`).join(",")}}`;
    const state = jsonState(doc);
    const ranges = collapsedRanges(state);

    expect(ranges).toHaveLength(5);
    for (const key of ["a", "b", "c", "d", "e"]) {
      // No collapse swallows the key
      const at = doc.indexOf(`"${key}":`);
      expect(ranges.some((r) => r.from <= at && r.to > at)).toBe(false);
    }
    expect(visibleLineLengths(state)[0]).toBeLessThanOrEqual(MAX_VISIBLE_LINE_CHARS);
  });

  test("collapses a value on a pretty-printed line", () => {
    const doc = `{\n  "name": "a.png",\n  "image": "${BIG}"\n}`;
    const state = jsonState(doc);
    const ranges = collapsedRanges(state);

    expect(ranges).toHaveLength(1);
    expect(state.sliceDoc(ranges[0]!.from, ranges[0]!.to)).toBe(BIG);
    // Only the long line is touched, and all that is left of it is `  "image": ""`
    expect(visibleLineLengths(state)).toEqual([1, 18, 13, 1]);
    expect(state.doc.line(2).text).toBe('  "name": "a.png",');
  });

  test("ignores tokens under the collapse threshold", () => {
    // Under the threshold once the surrounding quotes are counted
    const short = "C".repeat(COLLAPSE_TOKEN_CHARS - 10);
    const doc = `{${Array.from({ length: 4 }, (_, i) => `"k${i}":"${short}"`).join(",")}}`;
    expect(doc.length).toBeGreaterThan(MAX_VISIBLE_LINE_CHARS);

    // Nothing is big enough to collapse on its own, so the column rule takes over
    const ranges = collapsedRanges(jsonState(doc));
    expect(ranges).toHaveLength(1);
    expect(ranges[0]!.to).toBe(doc.length);
  });
});

describe("column collapsing, without a grammar", () => {
  test("collapses everything past the limit", () => {
    const ranges = collapsedRanges(plainState(BIG));
    expect(ranges).toHaveLength(1);
    expect(ranges[0]!.from).toBe(MAX_VISIBLE_LINE_CHARS);
    expect(ranges[0]!.to).toBe(BIG.length);
  });

  test("handles a long line of many short tokens", () => {
    // A single-line CSV row: no token is long enough to collapse on its own
    const row = Array.from({ length: 40_000 }, (_, i) => `value ${i}`).join(", ");
    const ranges = collapsedRanges(plainState(row));
    expect(ranges).toHaveLength(1);
    expect(ranges[0]!.from).toBe(MAX_VISIBLE_LINE_CHARS);
  });

  test("collapses each long line independently", () => {
    const doc = `${BIG}\nshort\n${BIG}`;
    const ranges = collapsedRanges(plainState(doc));
    expect(ranges).toHaveLength(2);
    for (const length of visibleLineLengths(plainState(doc))) {
      expect(length).toBeLessThanOrEqual(MAX_VISIBLE_LINE_CHARS);
    }
  });

  test("never hides a line break", () => {
    const doc = `${BIG}\nshort`;
    const state = plainState(doc);
    for (const { from, to } of collapsedRanges(state)) {
      expect(state.sliceDoc(from, to)).not.toContain("\n");
    }
    expect(state.doc.lines).toBe(2);
  });
});

describe("undelimited tokens", () => {
  // The text grammar parses a whole line as one token. Collapsing it whole would leave the
  // line with nothing on it but a tag, so the column cut handles it instead.
  const textState = (doc: string) => EditorState.create({ doc, extensions: [text(), largeValues] });

  test("falls back to the column cut for a long line of plain text", () => {
    const doc = Array.from({ length: 90_000 }, (_, i) => `word${i}`).join(" ");
    const ranges = collapsedRanges(textState(doc));

    expect(ranges).toHaveLength(1);
    expect(ranges[0]!.from).toBe(MAX_VISIBLE_LINE_CHARS);
    expect(ranges[0]!.to).toBe(doc.length);
  });

  test("leaves the start of the line readable", () => {
    const doc = `IMPORTANT-PREFIX ${"z".repeat(500_000)}`;
    const state = textState(doc);
    const ranges = collapsedRanges(state);

    expect(ranges[0]!.from).toBe(MAX_VISIBLE_LINE_CHARS);
    expect(state.sliceDoc(0, 16)).toBe("IMPORTANT-PREFIX");
  });
});

describe("recomputing", () => {
  test("updates when the document changes", () => {
    const state = plainState('{"image":"short"}');
    expect(collapsedRanges(state)).toEqual([]);

    const next = state.update({
      changes: { from: 0, to: state.doc.length, insert: BIG },
    }).state;
    expect(collapsedRanges(next)).toHaveLength(1);
  });
});
