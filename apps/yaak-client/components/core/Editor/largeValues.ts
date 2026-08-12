import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import type { EditorState, Extension, Range } from "@codemirror/state";
import { StateField } from "@codemirror/state";
import type { Tree as SyntaxTree } from "@lezer/common";
import type { DecorationSet } from "@codemirror/view";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import { LargeValueDialog } from "../../LargeValueDialog";

/**
 * How much of a line may be rendered before the rest is collapsed.
 *
 * VS Code draws nothing past column 10,000 (`editor.stopRenderingLineAfter`) for the same
 * reason. It can afford to be blunt about it because it doesn't soft wrap by default; we
 * collapse to a placeholder that can be opened instead.
 */
export const MAX_VISIBLE_LINE_CHARS = 10_000;

/**
 * A token longer than this on an over-long line is collapsed on its own, ahead of the column
 * cut, so the structure around it stays visible. Needs a grammar to find.
 */
export const COLLAPSE_TOKEN_CHARS = 5_000;

/** How much of a collapsed range stays visible at each end */
export const COLLAPSE_KEEP_CHARS = 100;

/**
 * Keeps over-long lines from reaching layout, which is what makes the editor stall on a
 * base64 blob or a minified payload.
 *
 * Cost tracks the length of the longest line, not the size of the document. A 1 MB response of
 * ordinary multi-line JSON renders fine, while the same 1 MB on a single line stalls the UI,
 * because soft wrap has to measure the whole line end to end to find its break points.
 * Measured in WKWebView, the engine macOS ships: 221 ms per render pass at 1 MB and 968 ms at
 * 3 MB, against 51 ms and 138 ms once collapsed, with soft wrap left on.
 *
 * Two rules, applied only to lines over {@link MAX_VISIBLE_LINE_CHARS}, so ordinary documents
 * are untouched:
 *
 * 1. Collapse individual tokens over {@link COLLAPSE_TOKEN_CHARS}. For a language with a
 *    grammar this is the whole base64 string, so everything around it stays readable. A
 *    minified body with several large values keeps all of its keys visible.
 * 2. Collapse whatever is still past the column limit. This needs no grammar, so it covers
 *    plain text and any line that isn't one big token.
 *
 * Nothing leaves the document. Copy, filter and save all still see the full text; the hidden
 * part is reachable through {@link LargeValueDialog}.
 *
 * Read-only editors only. Hiding part of a document someone is editing would mean editing
 * text they can't see.
 */

interface Collapse {
  /** Bounds of the hidden part */
  hiddenFrom: number;
  hiddenTo: number;
  /** Bounds of the whole value, including any visible ends, for the dialog */
  valueFrom: number;
  valueTo: number;
}

class LargeValueWidget extends WidgetType {
  constructor(private readonly collapse: Collapse) {
    super();
  }

  eq(other: LargeValueWidget) {
    return (
      other.collapse.hiddenFrom === this.collapse.hiddenFrom &&
      other.collapse.hiddenTo === this.collapse.hiddenTo
    );
  }

  toDOM(view: EditorView) {
    const { hiddenFrom, hiddenTo, valueFrom, valueTo } = this.collapse;
    const el = document.createElement("span");
    el.className = "cm-largeValue";
    el.textContent = `⋯ ${(hiddenTo - hiddenFrom).toLocaleString()} characters hidden ⋯`;
    el.title = "View full value";
    el.addEventListener("mousedown", (e) => {
      // Keep the editor from putting a cursor behind the dialog
      e.preventDefault();
      e.stopPropagation();
      LargeValueDialog.show(view.state.sliceDoc(valueFrom, valueTo));
    });
    return el;
  }

  ignoreEvent() {
    return false;
  }
}

interface Line {
  from: number;
  to: number;
}

/** Lines long enough to be a problem. Most documents have none, and we stop there. */
function findLongLines(text: string): Line[] {
  if (text.length <= MAX_VISIBLE_LINE_CHARS) {
    return []; // No line can be longer than the whole text
  }

  const lines: Line[] = [];
  let from = 0;
  for (;;) {
    const newline = text.indexOf("\n", from);
    const to = newline < 0 ? text.length : newline;
    if (to - from > MAX_VISIBLE_LINE_CHARS) {
      lines.push({ from, to });
    }
    if (newline < 0) {
      return lines;
    }
    from = newline + 1;
  }
}

/**
 * How long to spend parsing before falling back to the column rule.
 *
 * The initial parse is budgeted by time, so it stops partway through a document with several
 * large values, and we'd only find the first one. Parsing the rest of a 1 MB body costs about
 * 12 ms, against the 171 ms of layout it saves.
 */
const PARSE_TIMEOUT_MS = 100;

/** The parsed tree covering the long lines, as far as parsing got in the time allowed. */
function treeForLongLines(state: EditorState, longLines: Line[]): SyntaxTree {
  const lastLine = longLines[longLines.length - 1];
  if (lastLine == null) {
    return syntaxTree(state);
  }
  return ensureSyntaxTree(state, lastLine.to, PARSE_TIMEOUT_MS) ?? syntaxTree(state);
}

/** Tokens on this line big enough to collapse on their own, in document order. */
function findLargeTokens(tree: SyntaxTree, line: Line): Collapse[] {
  const collapses: Collapse[] = [];

  tree.iterate({
    from: line.from,
    to: line.to,
    enter: (node) => {
      // A node this small can't contain anything worth collapsing
      if (node.to - node.from < COLLAPSE_TOKEN_CHARS) return false;
      // Only leaves, so we collapse the string itself rather than the object holding it
      if (node.node.firstChild != null) return true;

      const valueFrom = Math.max(node.from, line.from);
      const valueTo = Math.min(node.to, line.to);
      const hiddenFrom = valueFrom + COLLAPSE_KEEP_CHARS;
      const hiddenTo = valueTo - COLLAPSE_KEEP_CHARS;
      if (hiddenTo > hiddenFrom) {
        collapses.push({ hiddenFrom, hiddenTo, valueFrom, valueTo });
      }
      return false;
    },
  });

  return collapses;
}

/**
 * Where the line runs past the column limit, counting only what is still visible after the
 * token collapses, or -1 if it fits.
 */
function findColumnCut(line: Line, tokens: Collapse[]): number {
  let visible = 0;
  let pos = line.from;

  for (const token of [...tokens, null]) {
    const segmentEnd = token == null ? line.to : token.hiddenFrom;
    if (segmentEnd > pos) {
      if (visible + (segmentEnd - pos) > MAX_VISIBLE_LINE_CHARS) {
        return pos + (MAX_VISIBLE_LINE_CHARS - visible);
      }
      visible += segmentEnd - pos;
    }
    if (token != null) {
      pos = token.hiddenTo;
    }
  }

  return -1;
}

function collapsesForLine(tree: SyntaxTree, line: Line): Collapse[] {
  const tokens = findLargeTokens(tree, line);
  const cut = findColumnCut(line, tokens);
  if (cut < 0) {
    return tokens;
  }

  // The cut always lands in a visible stretch, so it never splits a token collapse
  const kept = tokens.filter((t) => t.hiddenTo <= cut);
  kept.push({ hiddenFrom: cut, hiddenTo: line.to, valueFrom: cut, valueTo: line.to });
  return kept;
}

function buildDecorations(state: EditorState, longLines: Line[]): DecorationSet {
  if (longLines.length === 0) {
    return Decoration.none;
  }

  const tree = treeForLongLines(state, longLines);
  const ranges: Range<Decoration>[] = [];
  for (const line of longLines) {
    for (const collapse of collapsesForLine(tree, line)) {
      ranges.push(
        Decoration.replace({ widget: new LargeValueWidget(collapse) }).range(
          collapse.hiddenFrom,
          collapse.hiddenTo,
        ),
      );
    }
  }
  return Decoration.set(ranges);
}

interface LargeValueState {
  longLines: Line[];
  decorations: DecorationSet;
}

export const largeValueField = StateField.define<LargeValueState>({
  create(state) {
    const longLines = findLongLines(state.doc.toString());
    return { longLines, decorations: buildDecorations(state, longLines) };
  },

  update(value, tr) {
    if (tr.docChanged) {
      const longLines = findLongLines(tr.state.doc.toString());
      return { longLines, decorations: buildDecorations(tr.state, longLines) };
    }
    // Parsing is incremental, so a long line may only become a known token later. Documents
    // with no long line can never gain a collapse, so they skip this entirely.
    if (value.longLines.length > 0 && syntaxTree(tr.startState) !== syntaxTree(tr.state)) {
      return { ...value, decorations: buildDecorations(tr.state, value.longLines) };
    }
    return value;
  },

  provide: (f) => [
    EditorView.decorations.from(f, (v) => v.decorations),
    // Step the cursor over a placeholder instead of stranding it inside
    EditorView.atomicRanges.of(
      (view) => view.state.field(f, false)?.decorations ?? Decoration.none,
    ),
  ],
});

export const largeValues: Extension = [largeValueField];
