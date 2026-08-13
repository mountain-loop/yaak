import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { formatSize } from "@yaakapp-internal/lib/formatSize";
import type { EditorState, Extension, Range } from "@codemirror/state";
import { StateField } from "@codemirror/state";
import type { Tree as SyntaxTree } from "@lezer/common";
import type { DecorationSet } from "@codemirror/view";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import { copyToClipboard } from "../../../lib/copy";

/**
 * How much of a line may be rendered before the rest is collapsed.
 *
 * VS Code draws nothing past column 10,000 (`editor.stopRenderingLineAfter`) for the same
 * reason. It can afford to be blunt about it because it doesn't soft wrap by default; we
 * collapse to a placeholder that can be opened instead.
 */
export const MAX_VISIBLE_LINE_CHARS = 10_000;

/**
 * A quoted value longer than this on an over-long line is collapsed whole, ahead of the column
 * cut, so the structure around it stays visible. Needs a grammar to find.
 */
export const COLLAPSE_TOKEN_CHARS = 5_000;

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
 * 1. Collapse quoted values over {@link COLLAPSE_TOKEN_CHARS} whole, so a base64 string reads
 *    as `"image": "999.8 KB hidden…"` with its key intact. A minified body with several large values
 *    keeps every one of its keys. Needs a grammar to find the value.
 * 2. Collapse whatever is still past the column limit. This needs no grammar, so it covers
 *    plain text, undelimited tokens, and any line that is simply long.
 *
 * Nothing leaves the document. Copy, filter and save all still see the full text, and the tag
 * carries a button that copies exactly what it hides.
 *
 * Read-only editors only. Hiding part of a document someone is editing would mean editing
 * text they can't see.
 */

/** A hidden range. The tag stands in for exactly this text, and the dialog shows it. */
interface Collapse {
  from: number;
  to: number;
}

class LargeValueWidget extends WidgetType {
  constructor(
    private readonly from: number,
    private readonly to: number,
  ) {
    super();
  }

  eq(other: LargeValueWidget) {
    return other.from === this.from && other.to === this.to;
  }

  toDOM(view: EditorView) {
    const length = this.to - this.from;

    const el = document.createElement("span");
    // The same neutral tag styling a path parameter uses. The theme scope matters: these
    // tokens resolve against the tag palette, not the editor's ambient one, where a
    // tag-sized border is meant to be near invisible.
    el.className = "x-theme-templateTag x-theme-templateTag--secondary template-tag";

    const label = document.createElement("span");
    label.textContent = `${formatSize(length)} hidden…`;
    el.appendChild(label);

    // A span rather than a button: a button's box model makes the line taller. It keeps the
    // role and name so assistive tech still sees it as an action.
    const copy = document.createElement("span");
    copy.role = "button";
    copy.className = "tag-action";
    copy.title = `Copy hidden text (${length.toLocaleString()} characters)`;
    copy.ariaLabel = copy.title;
    // Lucide's `copy` icon, inlined because the widget builds its DOM synchronously and
    // rendering React here would leave it empty while CodeMirror measures line heights
    copy.innerHTML =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" ' +
      'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ' +
      'aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/>' +
      '<path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>';
    // Keep the editor from moving the cursor when the button is pressed
    copy.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    copy.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      copyToClipboard(view.state.sliceDoc(this.from, this.to));
    });
    el.appendChild(copy);

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

const QUOTES = ['"', "'", "`"];

/**
 * Quoted values on this line big enough to collapse whole, in document order.
 *
 * Everything between the quotes goes, so a long string reads as `"image": "<tag>"` and the key
 * still tells you what it is. Undelimited tokens are left to the column cut instead: replacing
 * one whole would leave the line with nothing on it but a tag.
 */
function findLargeTokens(state: EditorState, tree: SyntaxTree, line: Line): Collapse[] {
  const collapses: Collapse[] = [];

  tree.iterate({
    from: line.from,
    to: line.to,
    enter: (node) => {
      // A node this small can't contain anything worth collapsing
      if (node.to - node.from < COLLAPSE_TOKEN_CHARS) return false;
      // Only leaves, so we collapse the string itself rather than the object holding it
      if (node.node.firstChild != null) return true;

      const from = Math.max(node.from, line.from);
      const to = Math.min(node.to, line.to);
      const open = state.sliceDoc(from, from + 1);
      const quoted = to - from >= 2 && QUOTES.includes(open) && state.sliceDoc(to - 1, to) === open;

      if (quoted && to - 1 > from + 1) {
        collapses.push({ from: from + 1, to: to - 1 });
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
    const segmentEnd = token == null ? line.to : token.from;
    if (segmentEnd > pos) {
      if (visible + (segmentEnd - pos) > MAX_VISIBLE_LINE_CHARS) {
        return pos + (MAX_VISIBLE_LINE_CHARS - visible);
      }
      visible += segmentEnd - pos;
    }
    if (token != null) {
      pos = token.to;
    }
  }

  return -1;
}

function collapsesForLine(state: EditorState, tree: SyntaxTree, line: Line): Collapse[] {
  const tokens = findLargeTokens(state, tree, line);
  const cut = findColumnCut(line, tokens);
  if (cut < 0) {
    return tokens;
  }

  // The cut always lands in a visible stretch, so it never splits a token collapse
  const kept = tokens.filter((t) => t.to <= cut);
  kept.push({ from: cut, to: line.to });
  return kept;
}

function buildDecorations(state: EditorState, longLines: Line[]): DecorationSet {
  if (longLines.length === 0) {
    return Decoration.none;
  }

  const tree = treeForLongLines(state, longLines);
  const ranges: Range<Decoration>[] = [];
  for (const line of longLines) {
    for (const { from, to } of collapsesForLine(state, tree, line)) {
      ranges.push(Decoration.replace({ widget: new LargeValueWidget(from, to) }).range(from, to));
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
