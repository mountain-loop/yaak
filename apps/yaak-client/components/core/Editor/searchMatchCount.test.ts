import { SearchQuery } from "@codemirror/search";
import { EditorState } from "@codemirror/state";
import { describe, expect, test } from "vite-plus/test";
import {
  currentMatch,
  literalSearch,
  MAX_COUNT,
  MatchCounter,
  normalizeDoc,
  normalizeSearch,
  scanNormalized,
  scanQuery,
} from "./searchMatchCount";

type QueryConfig = ConstructorParameters<typeof SearchQuery>[0];

const stateOf = (doc: string) => EditorState.create({ doc });

/**
 * The matches the counter finds, having checked them against the search panel's own cursor.
 *
 * The cursor decides which ranges the editor highlights and which one `find next` lands on, so
 * a count that doesn't agree with it is a wrong count, however fast it was to produce.
 */
function matchesOf(doc: string, config: QueryConfig) {
  const state = stateOf(doc);
  const query = new SearchQuery(config);
  const matches = new MatchCounter().matches(state, query);
  expect(matches).toEqual(scanQuery(state, query));
  return matches;
}

const countOf = (doc: string, config: QueryConfig) => matchesOf(doc, config).length;

describe("counting", () => {
  test("counts every match, whatever the case", () => {
    expect(countOf("one Two three two", { search: "two" })).toBe(2);
    expect(countOf("one Two three two", { search: "two", caseSensitive: true })).toBe(1);
  });

  test("skips matches overlapping an earlier one", () => {
    expect(countOf("aaaaa", { search: "aa" })).toBe(2);
    expect(countOf("ababa", { search: "aba" })).toBe(1);
  });

  test("treats a query as text, not as a pattern", () => {
    expect(countOf("a.b axb", { search: "a.b" })).toBe(1);
  });

  test("unquotes escapes unless the query is literal", () => {
    expect(countOf("one\ntwo\nthree", { search: "\\n" })).toBe(2);
    expect(countOf("one\\ntwo", { search: "\\n", literal: true })).toBe(1);
  });

  test("counts regexp and whole word queries through the cursor", () => {
    expect(literalSearch(new SearchQuery({ search: "a", regexp: true }))).toBe(null);
    expect(literalSearch(new SearchQuery({ search: "a", wholeWord: true }))).toBe(null);
    expect(countOf("a1 b2 c3", { search: "[a-z]\\d", regexp: true })).toBe(3);
    expect(countOf("cat cats cat", { search: "cat", wholeWord: true })).toBe(2);
  });

  test("stops counting at the cap", () => {
    expect(countOf("x".repeat(MAX_COUNT + 100), { search: "x" })).toBe(MAX_COUNT + 1);
  });

  test("reports where the matches are", () => {
    expect(matchesOf("ab..ab", { search: "ab" })).toEqual([
      { from: 0, to: 2 },
      { from: 4, to: 6 },
    ]);
  });

  test("finds nothing to match with an empty needle", () => {
    expect(scanNormalized(normalizeDoc("abc", false), "")).toEqual([]);
  });
});

describe("normalization", () => {
  test("finds what a character decomposes into", () => {
    // The é is one character holding an `e`, and the match covers the whole of it
    expect(matchesOf("café", { search: "e" })).toEqual([{ from: 3, to: 4 }]);
    expect(matchesOf("ﬁle", { search: "fi" })).toEqual([{ from: 0, to: 1 }]);
    expect(matchesOf("a…b", { search: "..." })).toEqual([{ from: 1, to: 2 }]);
    expect(countOf("one two", { search: "one two" })).toBe(1);
    expect(countOf("ｆｕｌｌ width", { search: "full" })).toBe(1);
  });

  test("matches a decomposed query against composed text, and the reverse", () => {
    expect(countOf("café", { search: "café" })).toBe(1);
    expect(countOf("café", { search: "café" })).toBe(1);
    expect(countOf("café", { search: "café" })).toBe(1);
  });

  test("keeps offsets straight after an expansion", () => {
    expect(matchesOf("é.é.end", { search: "end" })).toEqual([{ from: 4, to: 7 }]);
    expect(matchesOf("ﬁﬁﬁ stop", { search: "stop" })).toEqual([{ from: 4, to: 8 }]);
  });

  test("normalizes the query whole, the document by character", () => {
    expect(normalizeSearch("CAFÉ", false)).toBe("café");
    expect(normalizeSearch("CAFÉ", true)).toBe("CAFÉ");
    // Whole-string NFKD would fold this to a final sigma, which the cursor never does
    expect(normalizeDoc("ΟΔΟΣ", false).text).toBe("οδοσ");
  });

  test("leaves a document that normalizes to itself untouched", () => {
    const { text, expansions } = normalizeDoc("plain 日本 🎉 text", false);
    expect(text).toBe("plain 日本 🎉 text");
    expect(expansions).toEqual([]);
  });
});

describe("current match", () => {
  const matches = [
    { from: 0, to: 2 },
    { from: 4, to: 6 },
    { from: 8, to: 10 },
  ];

  test("counts from one, and reports 0 off a match", () => {
    expect(currentMatch(matches, { from: 4, to: 6 })).toBe(2);
    expect(currentMatch(matches, { from: 8, to: 10 })).toBe(3);
    expect(currentMatch(matches, { from: 5, to: 5 })).toBe(2);
    expect(currentMatch(matches, { from: 2, to: 3 })).toBe(0);
    expect(currentMatch(matches, { from: 4, to: 7 })).toBe(0);
    expect(currentMatch([], { from: 0, to: 0 })).toBe(0);
  });

  test("moving the selection doesn't scan again", () => {
    const state = stateOf("a1 b2 c3");
    const query = new SearchQuery({ search: "\\d", regexp: true });
    const counter = new MatchCounter();
    const found = counter.matches(state, query);

    // The document a selection-only transaction leaves behind is the one already scanned
    const moved = state.update({ selection: { anchor: 4, head: 5 } }).state;
    expect(counter.matches(moved, query)).toBe(found);
    expect(currentMatch(found, moved.selection.main)).toBe(2);
  });
});

/**
 * The mapping from normalized offsets back to document offsets is the part of this that can go
 * quietly wrong, and only on input nobody thinks to write a case for. So generate the input.
 */
describe("against the cursor, on awkward text", () => {
  const ALPHABET = [
    ..."abcABC .\\\n".split(""),
    "é",
    "é",
    "ﬁ",
    "…",
    " ",
    "İ",
    "Σ",
    "ς",
    "日",
    "🎉",
    "Ⅻ",
    "ｆ",
    "①",
    "́",
  ];

  /** Seeded, so a failure is the same failure next run */
  function random(seed: number) {
    let state = seed;
    return () => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 2 ** 32;
    };
  }

  for (const caseSensitive of [false, true]) {
    test(`agrees on every generated document (caseSensitive: ${caseSensitive})`, () => {
      const next = random(caseSensitive ? 20260831 : 7);

      for (let round = 0; round < 400; round++) {
        const doc = Array.from(
          { length: 2 + Math.floor(next() * 60) },
          () => ALPHABET[Math.floor(next() * ALPHABET.length)]!,
        ).join("");

        // Half the queries are lifted out of the document, so matches are actually found
        const start = Math.floor(next() * doc.length);
        const search =
          next() < 0.5
            ? doc.slice(start, start + 1 + Math.floor(next() * 3))
            : Array.from(
                { length: 1 + Math.floor(next() * 2) },
                () => ALPHABET[Math.floor(next() * ALPHABET.length)]!,
              ).join("");
        if (search === "") continue;

        const state = stateOf(doc);
        const query = new SearchQuery({ search, caseSensitive });
        const where = `doc=${JSON.stringify(doc)} search=${JSON.stringify(search)}`;
        expect(new MatchCounter().matches(state, query), where).toEqual(scanQuery(state, query));
      }
    });
  }
});
