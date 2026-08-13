import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { formatSize } from "@yaakapp-internal/lib/formatSize";
import type { EditorState, Extension, Range } from "@codemirror/state";
import type { Tree as SyntaxTree } from "@lezer/common";
import type { DecorationSet, ViewUpdate } from "@codemirror/view";
import { Decoration, EditorView, ViewPlugin, WidgetType } from "@codemirror/view";
import { fireAndForget } from "../../../lib/fireAndForget";
import type { SniffedValue } from "./sniffValue";
import { isEncodedRun, SNIFF_HEAD_CHARS, sniffValue } from "./sniffValue";

/**
 * How much of a line may be rendered before the rest is collapsed.
 *
 * VS Code draws nothing past column 10,000 (`editor.stopRenderingLineAfter`) for the same
 * reason. It can afford to be blunt about it because it doesn't soft wrap by default; we
 * collapse to a placeholder that can be opened instead.
 */
export const MAX_VISIBLE_LINE_CHARS = 10_000;

/**
 * A quoted value longer than this is collapsed whole, whatever it turns out to hold. Long
 * enough that nothing a person might actually read is ever hidden on length alone.
 */
export const COLLAPSE_TOKEN_CHARS = 5_000;

/**
 * A quoted value longer than this is collapsed too, but only when {@link sniffValue} can say
 * what it is. Encoded media is never worth reading, so once we can name it and offer a viewer,
 * a tag beats a wall of base64 well below the length that would make it a rendering problem —
 * this covers the avatars and icons that make up most base64 in real payloads. Anything we
 * can't identify stays visible until it's big enough to be a problem on its own.
 */
export const COLLAPSE_MEDIA_CHARS = 1_000;

/**
 * Collapses what can't be read: over-long lines, which stall layout, and encoded media, which
 * is only noise on screen.
 *
 * Layout cost tracks the length of the longest line, not the size of the document. A 1 MB
 * response of ordinary multi-line JSON renders fine, while the same 1 MB on a single line stalls
 * the UI, because soft wrap has to measure the whole line end to end to find its break points.
 * Measured in WKWebView, the engine macOS ships: 221 ms per render pass at 1 MB and 968 ms at
 * 3 MB, against 51 ms and 138 ms once collapsed, with soft wrap left on.
 *
 * Three rules:
 *
 * 1. Collapse quoted values over {@link COLLAPSE_TOKEN_CHARS} whole, so a base64 string reads
 *    as `"image": "PNG · 999.8 KB"` with its key intact. A minified body with several large
 *    values keeps every one of its keys. Needs a grammar to find the value.
 * 2. Collapse quoted values over {@link COLLAPSE_MEDIA_CHARS} that sniff as a known format,
 *    which is what catches an ordinary embedded image long before it is a rendering problem.
 * 3. On a line still over {@link MAX_VISIBLE_LINE_CHARS}, collapse whatever is left past the
 *    column limit. This needs no grammar, so it covers plain text, undelimited tokens, and any
 *    line that is simply long.
 *
 * Only what the viewport covers is examined, and only lines long enough to hold a collapse are
 * looked at, so a document of ordinary short lines costs a length check per visible line and
 * nothing else — no grammar is consulted and no tree is walked.
 *
 * Nothing leaves the document. Copy, filter and save all still see the full text, and the tag
 * itself is a button, opening a menu that views, copies or saves exactly what it stands for.
 *
 * The value's own head says what it is — a `data:` URI names its media type, and raw base64
 * gives its format up in the first dozen bytes — so the tag can name the format and open the
 * value in the matching viewer without any of it being read. See {@link sniffValue}.
 *
 * Read-only editors only. Hiding part of a document someone is editing would mean editing
 * text they can't see.
 */

/**
 * A hidden range, the value it belongs to, and what that value turned out to be.
 *
 * The hidden range and the value differ under the column rule, where the value starts at the
 * beginning of the line but only what runs past the limit is hidden. The tag stands in for
 * [from, to) and copies exactly that; the viewer needs the whole value, [valueFrom, to).
 */
interface Collapse {
  from: number;
  to: number;
  valueFrom: number;
  sniffed: SniffedValue | null;
}

/**
 * Lucide's `chevron-down`, inlined because the widget builds its DOM synchronously and
 * rendering React here would leave it empty while CodeMirror measures line heights.
 */
const CHEVRON_DOWN =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" ' +
  'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ' +
  'aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';

/**
 * Marks the tag as the thing that opens the menu.
 *
 * The whole tag is the target rather than the chevron alone: there is only one action, and a
 * label you can't click next to a hit area a few pixels wide is a worse button than the tag
 * itself. The chevron stays as the affordance that says so.
 *
 * A span with a role rather than a real button, because a button's box model makes the line
 * taller — the one thing this extension exists to keep from happening.
 */
function makeTagButton(el: HTMLElement, title: string, onOpen: (at: DOMRect) => void) {
  el.role = "button";
  el.ariaHasPopup = "menu";
  el.tabIndex = 0;
  el.title = title;
  el.ariaLabel = title;

  // Keep the editor from moving the cursor when the tag is pressed
  el.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
  el.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    onOpen(el.getBoundingClientRect());
  });
  el.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    e.stopPropagation();
    onOpen(el.getBoundingClientRect());
  });
}

class LargeValueWidget extends WidgetType {
  constructor(
    private readonly from: number,
    private readonly to: number,
    private readonly valueFrom: number,
    private readonly sniffed: SniffedValue | null,
  ) {
    super();
  }

  eq(other: LargeValueWidget) {
    return (
      other.from === this.from &&
      other.to === this.to &&
      other.valueFrom === this.valueFrom &&
      other.sniffed?.mime === this.sniffed?.mime
    );
  }

  toDOM(view: EditorView) {
    const length = this.to - this.from;

    const el = document.createElement("span");
    // The same neutral tag styling a path parameter uses. The theme scope matters: these
    // tokens resolve against the tag palette, not the editor's ambient one, where a
    // tag-sized border is meant to be near invisible.
    el.className = "x-theme-templateTag x-theme-templateTag--secondary template-tag";

    const thumbnail = buildThumbnail(view, this.valueFrom, this.to, this.sniffed);
    if (thumbnail != null) {
      el.appendChild(thumbnail);
    }

    const label = document.createElement("span");
    // A named type reads as a stand-in for the value, so it only needs to say what and how big.
    // Without a name there is nothing to show but the fact that something is missing.
    label.textContent =
      this.sniffed == null
        ? `${formatSize(length)} hidden…`
        : `${this.sniffed.label} · ${formatSize(length)}`;
    el.appendChild(label);

    const chevron = document.createElement("span");
    chevron.className = "tag-action";
    chevron.ariaHidden = "true";
    chevron.innerHTML = CHEVRON_DOWN;
    el.appendChild(chevron);

    makeTagButton(
      el,
      this.sniffed == null ? "Value actions" : `${this.sniffed.label} actions`,
      (rect) => fireAndForget(this.openMenu(view, rect)),
    );

    return el;
  }

  /**
   * Copy, view and save, in a menu opened against the button.
   *
   * Everything the menu needs is pulled in on click. The editor loads on every response, and
   * neither the React menu nor the viewers behind the dialog are worth carrying until someone
   * asks for them.
   */
  private async openMenu(
    view: EditorView,
    rect: Pick<DOMRect, "top" | "bottom" | "left" | "right">,
  ) {
    const [{ showContextMenu }, { showLargeValueDialog }, { encodingLabel, largeValueActions }] =
      await Promise.all([
        import("../../../lib/contextMenu"),
        import("../../LargeValueDialog"),
        import("../../../lib/largeValue"),
      ]);

    const { sniffed } = this;
    // Sliced when an action runs rather than now, so opening the menu never touches the value
    const value = () => view.state.sliceDoc(this.valueFrom, this.to);
    const head = view.state.sliceDoc(
      this.valueFrom,
      Math.min(this.valueFrom + SNIFF_HEAD_CHARS, this.to),
    );

    showContextMenu({
      id: "large-value",
      // The whole tag, so the menu can align to whichever edge has room beside it
      triggerPosition: { x: rect.left, y: rect.bottom },
      triggerRect: rect,
      items: [
        { type: "separator", label: encodingLabel(head, sniffed, this.to - this.from) },
        ...largeValueActions({
          value,
          sniffed,
          // Exactly what the tag stands in for, which under the column rule is only the tail
          copyText: () => view.state.sliceDoc(this.from, this.to),
          onView: () => showLargeValueDialog({ text: value(), sniffed }),
        }),
      ],
    });
  }

  ignoreEvent() {
    return false;
  }
}

/**
 * How much encoded image a tag will preview. Roughly 3 MB of file, base64 being 4 bytes to 3.
 *
 * The decode runs on WebKit's image thread, but the bitmap it produces is sized by the image's
 * own dimensions, not by the box we draw it in — a 4000×3000 photo costs 48 MB however small the
 * thumbnail. So there has to be a limit, even though encoded size is only a proxy for the one
 * that matters: a well-compressed photo can decode larger than a lossless screenshot twice its
 * file size. This is set high enough to cover ordinary screenshots and wallpapers, since a tag
 * that previews some images and not others is worse than one that previews none. Only widgets in
 * the viewport are ever built, so a screenful is the most that decode at once.
 */
const THUMBNAIL_MAX_CHARS = 4_000_000;

/**
 * A preview of the value, at a size fixed before it loads.
 *
 * The box is a fixed square from the moment it's inserted, so the image arriving never changes
 * the line's height or the tag's width. A growing line box is the layout cost this whole
 * extension exists to avoid, and an image of unknown dimensions is the classic way to cause one.
 *
 * The src is the value's own text handed straight to the decoder as a data URI. Decoding the
 * base64 ourselves first would mean walking megabytes on the main thread, which is the one
 * thing that must not happen here.
 */
function buildThumbnail(
  view: EditorView,
  valueFrom: number,
  to: number,
  sniffed: SniffedValue | null,
): HTMLElement | null {
  if (sniffed == null || !sniffed.mime.startsWith("image/")) return null;
  if (sniffed.encoding !== "base64") return null;
  if (to - valueFrom > THUMBNAIL_MAX_CHARS) return null;

  const img = document.createElement("img");
  img.className = "tag-thumbnail";
  img.alt = "";
  img.ariaHidden = "true";
  img.decoding = "async";
  // A magic number can be wrong, and a data URI can lie. Drop the box rather than leave a
  // broken-image glyph sitting in the tag.
  img.addEventListener("error", () => img.remove());
  // Read the document and build the data URI after the widget is measured and on screen
  requestAnimationFrame(() => {
    if (!img.isConnected) return;
    const payload = view.state.sliceDoc(valueFrom + sniffed.offset, to);
    img.src = `data:${sniffed.mime};base64,${payload}`;
  });
  return img;
}

interface Line {
  from: number;
  to: number;
}

/**
 * The lines the given ranges touch, in document order and each listed once.
 *
 * Only lines long enough to hold a collapse are returned. That check is what keeps this free on
 * ordinary documents: no grammar is consulted and no tree is walked for a screen of short lines.
 */
function collapsibleLines(state: EditorState, ranges: readonly { from: number; to: number }[]) {
  const lines: Line[] = [];
  let lastFrom = -1;

  for (const range of ranges) {
    let pos = range.from;
    for (;;) {
      const line = state.doc.lineAt(pos);
      if (line.from > lastFrom) {
        lastFrom = line.from;
        if (line.to - line.from >= COLLAPSE_MEDIA_CHARS) {
          lines.push({ from: line.from, to: line.to });
        }
      }
      if (line.to >= range.to) break;
      pos = line.to + 1;
    }
  }

  return lines;
}

/**
 * How long to spend parsing before falling back to the column rule.
 *
 * The initial parse is budgeted by time, so it stops partway through a document with several
 * large values, and we'd only find the first one. Parsing the rest of a 1 MB body costs about
 * 12 ms, against the 171 ms of layout it saves.
 */
const PARSE_TIMEOUT_MS = 100;

/**
 * The parsed tree covering these lines.
 *
 * Parsing is only ever forced for a line long enough to stall layout, where finding the values
 * inside it is what saves the frame. For everything else we take whatever the background parse
 * has reached and decorate again when it advances — a forced parse runs from the top of the
 * document, so making one happen on every scroll would cost far more than the tags are worth.
 */
function treeForLines(state: EditorState, lines: Line[]): SyntaxTree {
  const last = lines[lines.length - 1];
  const stalls = lines.some((l) => l.to - l.from > MAX_VISIBLE_LINE_CHARS);
  if (last == null || !stalls) {
    return syntaxTree(state);
  }
  return ensureSyntaxTree(state, last.to, PARSE_TIMEOUT_MS) ?? syntaxTree(state);
}

const QUOTES = ['"', "'", "`"];

/**
 * Quoted values on this line worth collapsing, in document order.
 *
 * Everything between the quotes goes, so a long string reads as `"image": "<tag>"` and the key
 * still tells you what it is. Undelimited tokens are left to the column cut instead: replacing
 * one whole would leave the line with nothing on it but a tag.
 */
function findCollapsibleTokens(state: EditorState, tree: SyntaxTree, line: Line): Collapse[] {
  const collapses: Collapse[] = [];
  // Length alone only hides things on a line that would stall without it. On a line that renders
  // fine, being long is not a reason to hide something we can't even name.
  const stalls = line.to - line.from > MAX_VISIBLE_LINE_CHARS;

  tree.iterate({
    from: line.from,
    to: line.to,
    enter: (node) => {
      // A node this small can't contain anything worth collapsing, and neither can its children
      if (node.to - node.from < COLLAPSE_MEDIA_CHARS) return false;
      // Only leaves, so we collapse the string itself rather than the object holding it
      if (node.node.firstChild != null) return true;

      const from = Math.max(node.from, line.from);
      const to = Math.min(node.to, line.to);
      const open = state.sliceDoc(from, from + 1);
      const quoted = to - from >= 2 && QUOTES.includes(open) && state.sliceDoc(to - 1, to) === open;
      if (!quoted) return false;

      // Everything inside the quotes. The whole value is hidden, so it is its own value range
      const valueFrom = from + 1;
      const valueTo = to - 1;
      if (valueTo <= valueFrom) return false;

      // The head is all it takes, so this never reads the value it describes
      const head = state.sliceDoc(valueFrom, Math.min(valueFrom + SNIFF_HEAD_CHARS, valueTo));
      const sniffed = sniffValue(head);

      // Big enough to be a rendering problem on its own, or something we can both name and be
      // sure is encoded — a short magic number matches by chance, and hiding text would be worse
      // than showing base64
      const oversized = stalls && valueTo - valueFrom >= COLLAPSE_TOKEN_CHARS;
      const media =
        sniffed != null && sniffed.encoding === "base64" && isEncodedRun(head, sniffed.offset);
      if (oversized || media) {
        collapses.push({ from: valueFrom, to: valueTo, valueFrom, sniffed });
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
  const tokens = findCollapsibleTokens(state, tree, line);
  if (line.to - line.from <= MAX_VISIBLE_LINE_CHARS) {
    return tokens; // Short enough to render, so there is nothing left to cut
  }

  const cut = findColumnCut(line, tokens);
  if (cut < 0) {
    return tokens;
  }

  // The cut always lands in a visible stretch, so it never splits a token collapse
  const kept = tokens.filter((t) => t.to <= cut);
  // Only the tail is hidden, but the value it belongs to runs from the start of the line — a
  // body that is nothing but one base64 blob is still recognisable from there
  const head = state.sliceDoc(line.from, Math.min(line.from + SNIFF_HEAD_CHARS, line.to));
  kept.push({ from: cut, to: line.to, valueFrom: line.from, sniffed: sniffValue(head) });
  return kept;
}

/**
 * The collapses covering the given document ranges.
 *
 * Kept separate from the plugin so the rules can be exercised against a state directly, with no
 * view and no DOM.
 */
export function collapseDecorations(
  state: EditorState,
  ranges: readonly { from: number; to: number }[],
): DecorationSet {
  const lines = collapsibleLines(state, ranges);
  if (lines.length === 0) {
    return Decoration.none;
  }

  const tree = treeForLines(state, lines);
  const decorations: Range<Decoration>[] = [];
  for (const line of lines) {
    for (const { from, to, valueFrom, sniffed } of collapsesForLine(state, tree, line)) {
      const widget = new LargeValueWidget(from, to, valueFrom, sniffed);
      decorations.push(Decoration.replace({ widget }).range(from, to));
    }
  }
  return Decoration.set(decorations);
}

/**
 * Scoped to the viewport, so the cost is a screenful however big the document is.
 *
 * Recomputed when the document changes, when the viewport moves, and when background parsing
 * advances — a value can only be found once the grammar has reached it.
 */
const largeValuePlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = collapseDecorations(view.state, view.visibleRanges);
    }

    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.viewportChanged ||
        syntaxTree(update.startState) !== syntaxTree(update.state)
      ) {
        this.decorations = collapseDecorations(update.view.state, update.view.visibleRanges);
      }
    }
  },
  {
    decorations: (v) => v.decorations,
    // Step the cursor over a placeholder instead of stranding it inside
    provide: (plugin) =>
      EditorView.atomicRanges.of((view) => view.plugin(plugin)?.decorations ?? Decoration.none),
  },
);

export const largeValues: Extension = [largeValuePlugin];
