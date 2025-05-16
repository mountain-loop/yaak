import { syntaxTree } from '@codemirror/language';
import type { Range } from '@codemirror/state';
import type { DecorationSet, ViewUpdate } from '@codemirror/view';
import { Decoration, ViewPlugin, WidgetType, EditorView } from '@codemirror/view';

class PathPlaceholderWidget extends WidgetType {
  readonly #clickListenerCallback: () => void;

  constructor(
    readonly rawText: string,
    readonly startPos: number,
    readonly onClick: () => void,
  ) {
    super();
    this.#clickListenerCallback = () => {
      this.onClick?.();
    };
  }

  eq(other: PathPlaceholderWidget) {
    return this.startPos === other.startPos && this.rawText === other.rawText;
  }

  toDOM() {
    const elt = document.createElement('span');
    elt.className = `x-theme-templateTag x-theme-templateTag--secondary template-tag`;
    elt.textContent = this.rawText;
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

function pathParameters(
  view: EditorView,
  onClickPathParameter: (name: string) => void,
): DecorationSet {
  const widgets: Range<Decoration>[] = [];
  const tree = syntaxTree(view.state);
  for (const { from, to } of view.visibleRanges) {
    tree.iterate({
      from,
      to,
      enter(node) {
        if (node.name === 'Text') {
          // Find the `url` node and then jump into it to find the placeholders
          for (let i = node.from; i < node.to; i++) {
            const innerTree = syntaxTree(view.state).resolveInner(i);
            if (innerTree.node.name === 'url') {
              innerTree.toTree().iterate({
                enter(node) {
                  if (node.name !== 'Placeholder') return;
                  const globalFrom = innerTree.node.from + node.from;
                  const globalTo = innerTree.node.from + node.to;
                  const rawText = view.state.doc.sliceString(globalFrom, globalTo);
                  const onClick = () => onClickPathParameter(rawText);
                  const widget = new PathPlaceholderWidget(rawText, globalFrom, onClick);
                  const deco = Decoration.replace({ widget, inclusive: false });
                  widgets.push(deco.range(globalFrom, globalTo));
                },
              });
              break;
            }
          }
        }
      },
    });
  }

  // Widgets must be sorted start to end
  widgets.sort((a, b) => a.from - b.from);

  return Decoration.set(widgets);
}

export function pathParametersPlugin(onClickPathParameter: (name: string) => void) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = pathParameters(view, onClickPathParameter);
      }

      update(update: ViewUpdate) {
        this.decorations = pathParameters(update.view, onClickPathParameter);
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
