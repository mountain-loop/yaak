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
  test("adds URL replacement behavior to protocol and saved URL options", () => {
    const protocolConfig = getUrlCompletionConfig([]);
    const savedUrlConfig = getUrlCompletionConfig([{ label: "https://example.com" }]);

    expect(protocolConfig.options).toHaveLength(2);
    expect(protocolConfig.options.every((option) => option.apply === applyUrlCompletion)).toBe(
      true,
    );
    expect(savedUrlConfig.options[0]?.apply).toBe(applyUrlCompletion);
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
