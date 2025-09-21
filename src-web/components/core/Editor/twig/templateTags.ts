import { syntaxTree } from '@codemirror/language';
import type { Range } from '@codemirror/state';
import type { DecorationSet, ViewUpdate } from '@codemirror/view';
import { Decoration, ViewPlugin, WidgetType, EditorView } from '@codemirror/view';
import type { SyntaxNodeRef } from '@lezer/common';
import type { TwigCompletionOption } from './completion';

class TemplateTagWidget extends WidgetType {
  readonly #clickListenerCallback: () => void;

  constructor(
    readonly option: TwigCompletionOption,
    readonly rawTag: string,
    readonly startPos: number,
  ) {
    super();
    this.#clickListenerCallback = () => {
      this.option.onClick?.(this.rawTag, this.startPos);
    };
  }

  eq(other: TemplateTagWidget) {
    return (
      this.option.name === other.option.name &&
      this.option.type === other.option.type &&
      this.option.value === other.option.value &&
      this.rawTag === other.rawTag &&
      this.startPos === other.startPos
    );
  }

  toDOM() {
    const elt = document.createElement('span');
    elt.className = `x-theme-templateTag template-tag ${
      this.option.invalid
        ? 'x-theme-templateTag--danger'
        : this.option.type === 'variable'
          ? 'x-theme-templateTag--primary'
          : 'x-theme-templateTag--info'
    }`;
    elt.title = this.option.invalid ? 'Not Found' : (this.option.value ?? '');
    elt.setAttribute('data-tag-type', this.option.type);
    elt.textContent =
      this.option.type === 'function'
        ? `${this.option.name}(${this.option.args.length ? '…' : ''})`
        : this.option.name;
    elt.addEventListener('click', this.#clickListenerCallback);
    return elt;
  }

  destroy(dom: HTMLElement) {
    dom.removeEventListener('click', this.#clickListenerCallback);
    super.destroy(dom);
  }

  ignoreEvent() {
    return false;
  }
}

function templateTags(
  view: EditorView,
  options: TwigCompletionOption[],
  onClickMissingVariable: (name: string, rawTag: string, startPos: number) => void,
): DecorationSet {
  const widgets: Range<Decoration>[] = [];
  const tree = syntaxTree(view.state);
  for (const { from, to } of view.visibleRanges) {
    tree.iterate({
      from,
      to,
      enter(node) {
        if (node.name === 'Tag') {
          // Don't decorate if the cursor is inside the match
          if (isSelectionInsideNode(view, node)) return;

          const rawTag = view.state.doc.sliceString(node.from, node.to);

          // TODO: Search `node.tree` instead of using Regex here
          const inner = rawTag.replace(/^\$\{\[\s*/, '').replace(/\s*]}$/, '');
          let name = inner.match(/([\w.]+)[(]/)?.[1] ?? inner;

          if (inner.includes('\n')) {
            return;
          }

          // The beta named the function `Response` but was changed in stable.
          // Keep this here for a while because there's no easy way to migrate
          if (name === 'Response') {
            name = 'response';
          }

          let option = options.find(
            (o) => o.name === name || (o.type === 'function' && o.aliases?.includes(name)),
          );
          if (option == null) {
            const from = node.from; // Cache here so the reference doesn't change
            option = {
              invalid: true,
              type: 'variable',
              name: inner,
              value: null,
              label: inner,
              onClick: () => {
                onClickMissingVariable(name, rawTag, from);
              },
            };
          }

          const widget = new TemplateTagWidget(option, rawTag, node.from);
          const deco = Decoration.replace({ widget, inclusive: true });
          widgets.push(deco.range(node.from, node.to));
        }
      },
    });
  }

  // Widgets must be sorted start to end
  widgets.sort((a, b) => a.from - b.from);

  return Decoration.set(widgets);
}

export function templateTagsPlugin(
  options: TwigCompletionOption[],
  onClickMissingVariable: (name: string, tagValue: string, startPos: number) => void,
) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = templateTags(view, options, onClickMissingVariable);
      }

      update(update: ViewUpdate) {
        this.decorations = templateTags(update.view, options, onClickMissingVariable);
      }
    },
    {
      decorations(v) {
        return v.decorations;
      },
      provide(plugin) {
        return EditorView.atomicRanges.of((view) => {
          return view.plugin(plugin)?.decorations || Decoration.none;
        });
      },
    },
  );
}

function isSelectionInsideNode(view: EditorView, node: SyntaxNodeRef) {
  for (const r of view.state.selection.ranges) {
    if (r.from > node.from && r.to < node.to) return true;
  }
  return false;
}
