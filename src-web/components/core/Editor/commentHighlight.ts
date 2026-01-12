import type { Range } from '@codemirror/state';
import type { DecorationSet, ViewUpdate } from '@codemirror/view';
import { Decoration, type EditorView, ViewPlugin } from '@codemirror/view';

const commentMark = Decoration.mark({
  class: 'cm-comment',
  attributes: { 'data-comment': 'true' },
});

function getCommentDecorations(view: EditorView): DecorationSet {
  const decorations: Range<Decoration>[] = [];
  const doc = view.state.doc.toString();

  // Handle single-line comments
  for (let i = 1; i <= view.state.doc.lines; i++) {
    const line = view.state.doc.line(i);
    const text = line.text;
    const trimmed = text.trimStart();

    if (trimmed.startsWith('//')) {
      const commentStart = line.from + text.indexOf('//');
      decorations.push(commentMark.range(commentStart, line.to));
    }
  }

  // Handle multi-line comments
  const multiLineRegex = /\/\*[\s\S]*?\*\//g;
  let match: RegExpExecArray | null = null;
  while ((match = multiLineRegex.exec(doc)) !== null) {
    decorations.push(commentMark.range(match.index, match.index + match[0].length));
  }

  return Decoration.set(decorations, true);
}

export function commentHighlightPlugin() {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = getCommentDecorations(view);
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged) {
          this.decorations = getCommentDecorations(update.view);
        }
      }
    },
    {
      decorations(v) {
        return v.decorations;
      },
    },
  );
}
