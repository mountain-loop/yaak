import type { EditorView } from "@codemirror/view";
import type { RefObject } from "react";
import { IconButton } from "./IconButton";

/** What reformatting needs of an editor; the `EditorView` an editor's `setRef` hands over has it */
export type FormattableEditor = Pick<EditorView, "state" | "dispatch" | "contentDOM">;

/**
 * Replaces the editor's document with `format`'s version of it, and blurs it, since the cursor
 * resets anyway. The change goes through the editor's own `onChange`, as typing does.
 */
export async function formatEditor(
  editor: FormattableEditor,
  format: (text: string) => Promise<string>,
): Promise<void> {
  const before = editor.state.doc.toString();
  const formatted = await format(before);
  // Typed into while formatting: the result is out of date
  if (editor.state.doc.toString() !== before) return;
  if (formatted === before) return;
  editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: formatted } });
  editor.contentDOM.blur();
}

interface Props {
  /** The editor to reformat, as its `setRef` set it */
  editor: RefObject<FormattableEditor | null>;
  format: (text: string) => Promise<string>;
  /** A read-only editor can't be reformatted, so offers nothing */
  readOnly?: boolean;
}

/** Reformats an editable editor's contents, for an `ActionsBar` */
export function FormatAction({ editor, format, readOnly }: Props) {
  if (readOnly) return null;
  return (
    <IconButton
      showConfirm
      size="sm"
      title="Reformat contents"
      icon="magic_wand"
      variant="border"
      onClick={async () => {
        if (editor.current == null) return;
        await formatEditor(editor.current, format);
      }}
    />
  );
}
