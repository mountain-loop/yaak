import type { DecorationSet, ViewUpdate } from '@codemirror/view';
import { Decoration, hoverTooltip, MatchDecorator, ViewPlugin } from '@codemirror/view';
import { EditorView } from 'codemirror';

const REGEX =
  /(https?:\/\/(www\.)?[-a-zA-Z0-9@:%._+*~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_+*.~#?&/={}[\]]*))/g;

const tooltip = hoverTooltip(
  (view, pos, side) => {
    const { from, text } = view.state.doc.lineAt(pos);
    let match;
    let found: { start: number; end: number } | null = null;

    while ((match = REGEX.exec(text))) {
      const start = from + match.index;
      const end = start + match[0].length;

      if (pos >= start && pos <= end) {
        found = { start, end };
        break;
      }
    }

    if (found == null) {
      return null;
    }

    if ((found.start == pos && side < 0) || (found.end == pos && side > 0)) {
      return null;
    }

    return {
      pos: found.start,
      end: found.end,
      create() {
        const dom = document.createElement('a');
        dom.textContent = 'Open in browser';
        dom.href = text.substring(found!.start - from, found!.end - from);
        dom.target = '_blank';
        dom.rel = 'noopener noreferrer';
        return { dom };
      },
    };
  },
  {
    hoverTime: 150,
  },
);

const decorator = function () {
  const placeholderMatcher = new MatchDecorator({
    regexp: REGEX,
    decoration(match, view, matchStartPos) {
      const matchEndPos = matchStartPos + match[0].length - 1;

      // Don't decorate if the cursor is inside the match
      for (const r of view.state.selection.ranges) {
        if (r.from > matchStartPos && r.to <= matchEndPos) {
          return Decoration.replace({});
        }
      }

      const groupMatch = match[1];
      if (groupMatch == null) {
        // Should never happen, but make TS happy
        console.warn('Group match was empty', match);
        return Decoration.replace({});
      }

      return Decoration.mark({
        class: 'hyperlink-widget',
      });
    },
  });

  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = placeholderMatcher.createDeco(view);
      }

      update(update: ViewUpdate) {
        this.decorations = placeholderMatcher.updateDeco(update, this.decorations);
      }
    },
    {
      decorations: (instance) => instance.decorations,
      provide: (plugin) =>
        EditorView.bidiIsolatedRanges.of((view) => {
          return view.plugin(plugin)?.decorations || Decoration.none;
        }),
    },
  );
};

export const hyperlink = [tooltip, decorator()];
