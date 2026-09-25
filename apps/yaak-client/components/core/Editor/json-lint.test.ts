import type { EditorView } from "@codemirror/view";
import { describe, expect, test } from "vite-plus/test";
import { jsonParseLinter } from "./json-lint";

// The linter only reads the document text off the view
function view(doc: string): EditorView {
  return { state: { doc: { toString: () => doc } } } as EditorView;
}

const lint = jsonParseLinter();

describe("jsonParseLinter", () => {
  test("reports nothing for an empty document", () => {
    expect(lint(view("  "))).toEqual([]);
  });

  test("reports nothing for valid JSON", () => {
    expect(lint(view('{"a": 1}'))).toEqual([]);
  });

  test("reports a message for invalid JSON", () => {
    expect(lint(view('{"a": }'))).toHaveLength(1);
  });

  test("ignores a template tag standing in for a value", () => {
    expect(lint(view('{"a": "${[ my_var ]}"}'))).toEqual([]);
  });

  test("ignores a tag whose quoted argument contains `]}`", () => {
    expect(lint(view(`{"a": "\${[ fn(arg='x]}y') ]}"}`))).toEqual([]);
  });

  test("ignores a tag whose quoted argument contains an escaped quote", () => {
    expect(lint(view(`{"a": "\${[ fn(arg='it\\'s ]}') ]}"}`))).toEqual([]);
  });

  test("still reports errors around a tag with a quoted `]}`", () => {
    expect(lint(view(`{"a": "\${[ fn(arg='x]}y') ]}",}`))).toHaveLength(1);
  });

  test("keeps the tag's length so error offsets stay correct", () => {
    const doc = `{"a" "\${[ fn(arg='x]}y') ]}"}`;
    const [error] = lint(view(doc));
    expect(error?.from).toEqual(doc.indexOf('"${['));
  });
});
