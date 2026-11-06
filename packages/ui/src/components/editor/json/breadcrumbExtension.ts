import { syntaxTree } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import type { EditorView, ViewUpdate } from "@codemirror/view";
import { ViewPlugin } from "@codemirror/view";
import type { JsonPathSegment } from "./jsonPath";
import { jsonPathSegmentsAt } from "./jsonPath";

export interface BreadcrumbUpdate {
  /** Path to the cursor, or `null` when the document isn't JSON. */
  segments: JsonPathSegment[] | null;
}

/**
 * Reports the JSON path under the cursor when the editor is created (it may restore a
 * cached selection), and whenever the selection, document, or parsed tree changes. The
 * tree matters because large documents parse in the background, so a path read early
 * can be wrong until the parser reaches the cursor.
 *
 * The callback is not fired on blur: moving focus to the filter box (by clicking
 * a crumb) must not erase the breadcrumb that was just acted on.
 */
export function jsonBreadcrumbExtension(onUpdate: (update: BreadcrumbUpdate) => void): Extension {
  const report = (view: EditorView) => {
    onUpdate({ segments: jsonPathSegmentsAt(view.state, view.state.selection.main.head) });
  };

  return ViewPlugin.define((view) => {
    report(view);
    return {
      update(update: ViewUpdate) {
        if (
          update.selectionSet ||
          update.docChanged ||
          syntaxTree(update.startState) !== syntaxTree(update.state)
        ) {
          report(update.view);
        }
      },
    };
  });
}
