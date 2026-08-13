import { EditorState } from "@codemirror/state";
import { jsonc } from "@shopify/lang-jsonc";
import { text } from "./text/extension";
import { describe, expect, test } from "vite-plus/test";
import {
  COLLAPSE_MEDIA_CHARS,
  COLLAPSE_TOKEN_CHARS,
  collapseDecorations,
  largeValues,
  MAX_VISIBLE_LINE_CHARS,
} from "./largeValues";
import type { SniffedValue } from "./sniffValue";

const BIG = "A".repeat(1_000_000);

/** With a grammar, so tokens can be collapsed individually */
const jsonState = (doc: string) => EditorState.create({ doc, extensions: [jsonc(), largeValues] });

/** Without a grammar, so only the column rule applies */
const plainState = (doc: string) => EditorState.create({ doc, extensions: largeValues });

/**
 * The decorations as if the whole document were on screen.
 *
 * In the editor the plugin passes the viewport instead, which is the same call with narrower
 * ranges — the rules themselves don't know the difference.
 */
function decorationsFor(state: EditorState) {
  return collapseDecorations(state, [{ from: 0, to: state.doc.length }]);
}

function collapsedRanges(state: EditorState) {
  const ranges: { from: number; to: number }[] = [];
  const iter = decorationsFor(state).iter();
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

  // Small enough that the parse always finishes inside PARSE_TIMEOUT_MS, even on a slow
  // machine. With a bigger body this falls back to the column cut, which is by design but
  // makes the assertion depend on how fast the runner is.
  test("keeps every key visible in a minified body with several large values", () => {
    const chunk = "B".repeat(20_000);
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

describe("sniffing the collapsed value", () => {
  /** The widget standing in for each collapse, in document order */
  function widgets(state: EditorState) {
    const found: { valueFrom: number; sniffed: SniffedValue | null }[] = [];
    const iter = decorationsFor(state).iter();
    while (iter.value != null) {
      found.push(iter.value.spec.widget);
      iter.next();
    }
    return found;
  }

  /** A base64 value that starts with a PNG signature and runs on well past the limits */
  function pngBase64(length = 1_000_000) {
    const bytes = new Uint8Array(length);
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  }

  test("names the format of a base64 value inside JSON", () => {
    const state = jsonState(`{"image":"${pngBase64()}"}`);
    expect(widgets(state)[0]?.sniffed).toMatchObject({ mime: "image/png", label: "PNG" });
  });

  test("names the format of a data URI", () => {
    const doc = `{"image":"data:image/jpeg;base64,${BIG}"}`;
    expect(widgets(jsonState(doc))[0]?.sniffed).toMatchObject({ label: "JPEG" });
  });

  test("names nothing when the value is just text", () => {
    expect(widgets(jsonState(`{"image":"${BIG}"}`))[0]?.sniffed).toBeNull();
    expect(widgets(plainState(BIG))[0]?.sniffed).toBeNull();
  });

  test("reads a column cut from the start of its line, not from the cut", () => {
    // A body that is nothing but one base64 blob: the tail is hidden, but the value it
    // belongs to begins at the start of the line, which is where the signature is
    const state = plainState(pngBase64());
    const [widget] = widgets(state);

    expect(widget?.valueFrom).toBe(0);
    expect(widget?.sniffed).toMatchObject({ label: "PNG" });
  });

  test("reads a token collapse from the value itself", () => {
    const doc = `{"image":"${pngBase64()}"}`;
    const [widget] = widgets(jsonState(doc));

    // Just past the opening quote, so the signature is the first thing it sees
    expect(widget?.valueFrom).toBe(doc.indexOf('"', doc.indexOf("image") + 6) + 1);
    expect(widget?.sniffed).toMatchObject({ label: "PNG" });
  });

  test("names nothing when a column cut lands mid-line after other text", () => {
    const state = plainState(`some prefix text ${pngBase64()}`);
    expect(widgets(state)[0]?.sniffed).toBeNull();
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

describe("media collapsing, below the length rules", () => {
  /** A real PNG signature, at a size that no length rule would touch */
  function png(bytes: number) {
    const b = new Uint8Array(bytes);
    b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    let binary = "";
    for (const byte of b) binary += String.fromCharCode(byte);
    return btoa(binary);
  }

  /** Well under every length threshold, so only the media rule can collapse it */
  const SMALL = png(3_000);

  test("collapses a small image on a short line", () => {
    expect(SMALL.length).toBeLessThan(MAX_VISIBLE_LINE_CHARS);
    expect(SMALL.length).toBeLessThan(COLLAPSE_TOKEN_CHARS);

    const state = jsonState(`{\n  "avatar": "${SMALL}"\n}`);
    const ranges = collapsedRanges(state);

    expect(ranges).toHaveLength(1);
    expect(state.sliceDoc(ranges[0]!.from, ranges[0]!.to)).toBe(SMALL);
  });

  test("names it, so the tag can say what it is", () => {
    const state = jsonState(`{"avatar":"${SMALL}"}`);
    const iter = decorationsFor(state).iter();
    expect(iter.value?.spec.widget.sniffed).toMatchObject({ mime: "image/png", label: "PNG" });
  });

  test("leaves a value of the same size alone when nothing recognises it", () => {
    // The only difference from the case above is what the bytes turn out to be
    const prose = "x".repeat(SMALL.length);
    expect(collapsedRanges(jsonState(`{"note":"${prose}"}`))).toEqual([]);
  });

  test("leaves anything under the media threshold alone, recognised or not", () => {
    const tiny = png(400);
    expect(tiny.length).toBeLessThan(COLLAPSE_MEDIA_CHARS);
    expect(collapsedRanges(jsonState(`{"icon":"${tiny}"}`))).toEqual([]);
  });

  test("leaves text alone even when its first bytes match a signature", () => {
    // `Qk0` decodes to `BM`, the whole of the BMP signature. Two bytes come up by chance often
    // enough that the sniff alone must not be allowed to hide something.
    const prose = `Qk0 ${"the quick brown fox jumps over the lazy dog. ".repeat(40)}`;
    expect(prose.length).toBeGreaterThan(COLLAPSE_MEDIA_CHARS);
    expect(collapsedRanges(jsonState(`{"note":"${prose}"}`))).toEqual([]);
  });

  test("still collapses it once it is long enough to be a rendering problem", () => {
    // Past the length rule the sniff no longer decides anything, so this is hidden for its size
    const prose = "Qk0 " + "words and more words ".repeat(COLLAPSE_TOKEN_CHARS);
    expect(collapsedRanges(jsonState(`{"note":"${prose}"}`))).toHaveLength(1);
  });

  test("collapses a data URI on a short line", () => {
    const state = jsonState(`{"avatar":"data:image/jpeg;base64,${SMALL}"}`);
    expect(collapsedRanges(state)).toHaveLength(1);
  });

  test("still leaves an ordinary document completely untouched", () => {
    const doc = Array.from({ length: 5_000 }, (_, i) => `  { "id": ${i}, "name": "item" },`).join(
      "\n",
    );
    expect(collapsedRanges(jsonState(doc))).toEqual([]);
  });
});

describe("viewport scoping", () => {
  const doc = () => {
    const value = "A".repeat(COLLAPSE_TOKEN_CHARS * 2);
    return `{\n${["a", "b", "c"].map((k) => `  "${k}": "${value}"`).join(",\n")}\n}`;
  };

  test("decorates only the ranges it is given", () => {
    const state = jsonState(doc());
    const secondLine = state.doc.line(3);

    const all = collapseDecorations(state, [{ from: 0, to: state.doc.length }]);
    const one = collapseDecorations(state, [{ from: secondLine.from, to: secondLine.to }]);

    expect(all.size).toBe(3);
    expect(one.size).toBe(1);
  });

  test("covers a line the range only partly overlaps", () => {
    // The viewport can start mid-line; the collapse still has to span the whole value
    const state = jsonState(doc());
    const line = state.doc.line(2);
    const partial = collapseDecorations(state, [{ from: line.from + 5, to: line.from + 6 }]);

    expect(partial.size).toBe(1);
    const iter = partial.iter();
    expect(iter.to).toBeGreaterThan(line.from + 6);
  });
});
