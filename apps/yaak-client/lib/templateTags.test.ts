/* oxlint-disable no-template-curly-in-string */

import { describe, expect, test } from "vite-plus/test";
import { findTemplateTags, replaceTemplateTags } from "./templateTags";

/** Seeded so a fuzz failure reproduces. */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function millis(run: () => void): number {
  const started = performance.now();
  run();
  return performance.now() - started;
}

describe("findTemplateTags", () => {
  test("finds a simple tag", () => {
    expect(findTemplateTags("${[ my_var ]}")).toEqual([{ start: 0, end: 13, inner: " my_var " }]);
  });

  test("finds a tag surrounded by text", () => {
    const text = 'a="${[ my_var ]}"';
    expect(findTemplateTags(text)).toEqual([{ start: 3, end: 16, inner: " my_var " }]);
    expect(text.slice(3, 16)).toEqual("${[ my_var ]}");
  });

  test("finds an empty tag", () => {
    expect(findTemplateTags("${[]}")).toEqual([{ start: 0, end: 5, inner: "" }]);
  });

  test("keeps a quoted `]}` inside the tag", () => {
    const text = "${[ fn(a='x]}y') ]}";
    expect(findTemplateTags(text)).toEqual([
      { start: 0, end: text.length, inner: " fn(a='x]}y') " },
    ]);
  });

  test("keeps an escaped quote inside the string", () => {
    const text = "${[ fn(a='it\\'s ]}') ]}";
    expect(findTemplateTags(text)).toEqual([
      { start: 0, end: text.length, inner: " fn(a='it\\'s ]}') " },
    ]);
  });

  test("keeps a b64 string in one tag", () => {
    const text = "${[ b64'Zm9v' ]}";
    expect(findTemplateTags(text)).toEqual([{ start: 0, end: text.length, inner: " b64'Zm9v' " }]);
  });

  test("closes at the first `]}` when a quote is left unterminated", () => {
    const text = "${[ fn(a='unterminated ]} rest";
    expect(findTemplateTags(text)).toEqual([{ start: 0, end: 25, inner: " fn(a='unterminated " }]);
    expect(text.slice(0, 25)).toEqual("${[ fn(a='unterminated ]}");
  });

  test("finds two tags with text between them", () => {
    expect(findTemplateTags("one ${[ a ]} two ${[ b ]} three")).toEqual([
      { start: 4, end: 12, inner: " a " },
      { start: 17, end: 25, inner: " b " },
    ]);
  });

  test("finds two adjacent tags", () => {
    expect(findTemplateTags("${[ a ]} ${[ b ]}")).toEqual([
      { start: 0, end: 8, inner: " a " },
      { start: 9, end: 17, inner: " b " },
    ]);
  });

  test("finds two tags that each quote a `]}`", () => {
    const text = "${[ a(x='1]}') ]} and ${[ b(y='2]}') ]}";
    expect(findTemplateTags(text)).toEqual([
      { start: 0, end: 17, inner: " a(x='1]}') " },
      { start: 22, end: 39, inner: " b(y='2]}') " },
    ]);
  });

  test("finds nothing in an unclosed tag", () => {
    expect(findTemplateTags("${[ no close")).toEqual([]);
  });

  test("finds nothing in text without tags", () => {
    expect(findTemplateTags('{"a": "${b}", "c": 1}')).toEqual([]);
  });

  test("treats a nested `${[` as ordinary content", () => {
    expect(findTemplateTags("${[ a ${[ b ]}")).toEqual([{ start: 0, end: 14, inner: " a ${[ b " }]);
  });

  test("finishes fast on a long run of quotes", () => {
    const text = `\${[${"'".repeat(20_000)} ]}`;
    let matches: unknown;
    const elapsed = millis(() => {
      matches = findTemplateTags(text);
    });
    expect(matches).toEqual([{ start: 0, end: text.length, inner: `${"'".repeat(20_000)} ` }]);
    expect(elapsed).toBeLessThan(200);
  });

  test("finishes fast on a long run of unpairable quotes", () => {
    // Every quote is escaped, so none of them opens a string that closes
    const text = `\${[${"\\'".repeat(20_000)} ]}`;
    let matches: unknown;
    const elapsed = millis(() => {
      matches = findTemplateTags(text);
    });
    expect(matches).toHaveLength(1);
    expect(elapsed).toBeLessThan(200);
  });

  test("finishes fast on a long run of openers that never close", () => {
    const text = "${[".repeat(20_000);
    let matches: unknown;
    const elapsed = millis(() => {
      matches = findTemplateTags(text);
    });
    expect(matches).toEqual([]);
    expect(elapsed).toBeLessThan(200);
  });

  test("never throws, and always reports real bounds", () => {
    const alphabet = ["$", "{", "[", "]", "}", "'", "\\", "a", "b"];
    const next = random(0x5eed);

    for (let n = 0; n < 2_000; n++) {
      let text = "";
      const length = Math.floor(next() * 31);
      for (let i = 0; i < length; i++) {
        text += alphabet[Math.floor(next() * alphabet.length)];
      }

      let matches: ReturnType<typeof findTemplateTags> = [];
      expect(() => {
        matches = findTemplateTags(text);
      }, text).not.toThrow();

      let previousEnd = 0;
      for (const match of matches) {
        expect(text.slice(match.start, match.start + 3), text).toEqual("${[");
        expect(text.slice(match.end - 2, match.end), text).toEqual("]}");
        expect(text.slice(match.start + 3, match.end - 2), text).toEqual(match.inner);
        expect(match.start, text).toBeGreaterThanOrEqual(previousEnd);
        previousEnd = match.end;
      }
    }
  });
});

describe("replaceTemplateTags", () => {
  test("leaves text without tags alone", () => {
    expect(replaceTemplateTags('{"a": 1}', () => "x")).toEqual('{"a": 1}');
  });

  test("replaces each tag with its trimmed contents", () => {
    expect(replaceTemplateTags("${[ a ]}/x/${[ b ]}", (m) => m.inner.trim())).toEqual("a/x/b");
  });

  test("keeps the replaced length when padding", () => {
    const tag = "${[ fn(arg='x]}y') ]}";
    const text = `{"a": "${tag}"}`;
    const replaced = replaceTemplateTags(text, (m) => "1".repeat(m.end - m.start));
    expect(replaced).toEqual(`{"a": "${"1".repeat(tag.length)}"}`);
    expect(replaced).toHaveLength(text.length);
  });

  test("leaves an unclosed tag in place", () => {
    expect(replaceTemplateTags("${[ oops", () => "x")).toEqual("${[ oops");
  });
});
