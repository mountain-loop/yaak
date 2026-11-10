import { EditorState } from "@codemirror/state";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vite-plus/test";
import { FormatAction, type FormattableEditor, formatEditor } from "./FormatAction";

/** An editor as far as formatting reaches into one, recording its changes and blurs */
function fakeEditor(text: string) {
  const changes: string[] = [];
  const blur = vi.fn();
  let state = EditorState.create({ doc: text });
  const editor: FormattableEditor & { changes: string[]; blur: typeof blur } = {
    get state() {
      return state;
    },
    dispatch: ((spec: { changes: { from: number; to: number; insert: string } }) => {
      state = state.update(spec).state;
      changes.push(state.doc.toString());
    }) as FormattableEditor["dispatch"],
    contentDOM: { blur } as unknown as HTMLElement,
    changes,
    blur,
  };
  return editor;
}

describe("formatEditor", () => {
  test("replaces the document with its formatted version and blurs", async () => {
    const editor = fakeEditor('{"a":1}');
    await formatEditor(editor, async (t) => JSON.stringify(JSON.parse(t), null, 2));
    expect(editor.state.doc.toString()).toBe('{\n  "a": 1\n}');
    expect(editor.changes).toHaveLength(1);
    expect(editor.blur).toHaveBeenCalledOnce();
  });

  test("leaves a document that is already formatted alone", async () => {
    const editor = fakeEditor("same");
    await formatEditor(editor, async (t) => t);
    expect(editor.changes).toHaveLength(0);
  });

  test("drops a result for text that changed while it was formatting", async () => {
    const editor = fakeEditor("before");
    await formatEditor(editor, async () => {
      editor.dispatch({ changes: { from: 0, to: 6, insert: "typed" } });
      return "formatted";
    });
    expect(editor.state.doc.toString()).toBe("typed");
  });
});

describe("FormatAction", () => {
  test("is offered for an editable editor only", () => {
    const editor = { current: null };
    const format = async (t: string) => t;
    expect(renderToStaticMarkup(<FormatAction editor={editor} format={format} />)).toContain(
      "Reformat contents",
    );
    expect(renderToStaticMarkup(<FormatAction editor={editor} format={format} readOnly />)).toBe(
      "",
    );
  });
});
