import type { Completion } from "@codemirror/autocomplete";
import { EditorState, type TransactionSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { describe, expect, test } from "vite-plus/test";
import { applyUrlCompletion, getUrlCompletionConfig } from "./completion";

describe("applyUrlCompletion", () => {
  test("consumes an existing protocol suffix and preserves the rest of the URL", () => {
    expect(applyCompletion("http://rickandmortyapi.com/api/character", "http://", 4)).toBe(
      "http://rickandmortyapi.com/api/character",
    );
  });

  test("inserts a protocol when there is no existing suffix", () => {
    expect(applyCompletion("htt", "http://", 3)).toBe("http://");
  });

  test("replaces the full URL when accepting a saved URL", () => {
    expect(applyCompletion("htt://old.example/path", "https://new.example/api", 3)).toBe(
      "https://new.example/api",
    );
  });
});

describe("getUrlCompletionConfig", () => {
  test("always includes protocols alongside saved URL options", () => {
    const config = getUrlCompletionConfig([{ label: "https://example.com" }]);

    expect(config.options.map((option) => option.label)).toEqual([
      "http://",
      "https://",
      "https://example.com",
    ]);
    expect(config.options.every((option) => option.apply === applyUrlCompletion)).toBe(true);
  });
});

function applyCompletion(document: string, label: string, cursor: number) {
  let state = EditorState.create({ doc: document, selection: { anchor: cursor } });
  const view = {
    state,
    dispatch: (spec: TransactionSpec) => {
      state = state.update(spec).state;
    },
  } as unknown as EditorView;

  applyUrlCompletion(view, { label } satisfies Completion, 0, cursor);
  return state.doc.toString();
}
