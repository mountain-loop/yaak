import type { DecorationSet, ViewUpdate } from '@codemirror/view';
import { Decoration, EditorView, MatchDecorator, ViewPlugin, hoverTooltip } from '@codemirror/view';
import { activeWorkspaceIdAtom } from '../../../../hooks/useActiveWorkspace';
import { copyToClipboard } from '../../../../lib/copy';
import { createRequestAndNavigate } from '../../../../lib/createRequestAndNavigate';
import { jotaiStore } from '../../../../lib/jotai';

const REGEX =
  /(https?:\/\/([-a-zA-Z0-9@:%._+*~#=]{1,256})+(\.[a-zA-Z0-9()]{1,6})?\b([-a-zA-Z0-9()@:%_+*.~#?&/={}[\]]*))/g;

const tooltip = hoverTooltip(
  (view, pos, side) => {
    const { from, text } = view.state.doc.lineAt(pos);
    let match: RegExpExecArray | null;
    let found: { start: number; end: number } | null = null;

    // biome-ignore lint/suspicious/noAssignInExpressions: <explanation>
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

    if ((found.start === pos && side < 0) || (found.end === pos && side > 0)) {
      return null;
    }

    return {
      pos: found.start,
      end: found.end,
      create() {
        const workspaceId = jotaiStore.get(activeWorkspaceIdAtom);
        const link = text.substring(found?.start - from, found?.end - from);
        const dom = document.createElement('div');

        const $open = document.createElement('a');
        $open.textContent = 'Open in browser';
        $open.href = link;
        $open.target = '_blank';
        $open.rel = 'noopener noreferrer';

        const $copy = document.createElement('button');
        $copy.textContent = 'Copy to clipboard';
        $copy.addEventListener('click', () => {
          copyToClipboard(link);
        });

        const $create = document.createElement('button');
        $create.textContent = 'Create new request';
        $create.addEventListener('click', async () => {
          await createRequestAndNavigate({
            model: 'http_request',
            workspaceId: workspaceId ?? 'n/a',
            url: link,
          });
        });

        dom.appendChild($open);
        dom.appendChild($copy);
        if (workspaceId != null) {
          dom.appendChild($create);
        }

        return { dom };
      },
    };
  },
  {
    hoverTime: 150,
  },
);

const decorator = () => {
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
