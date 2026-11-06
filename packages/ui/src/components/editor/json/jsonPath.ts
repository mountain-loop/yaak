import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import type { JsonPathSegment } from "@yaakapp-internal/lib/jsonPath";

export { jsonPathToSegments } from "@yaakapp-internal/lib/jsonPath";
export type { JsonPathSegment } from "@yaakapp-internal/lib/jsonPath";

// Lezer node names from the JSONC grammar (@shopify/lang-jsonc). A JSON value is
// exactly one of these; everything else in the tree is punctuation or a comment.
const VALUE_NODES = new Set(["Object", "Array", "String", "Number", "True", "False", "Null"]);
// The nodes with children that a caret can land "between" — its whitespace and
// punctuation belong to the container, not to any value inside it.
const CONTAINER_NODES = new Set(["Object", "Array", "JsoncText"]);

/** Read a `PropertyName` (a quoted JSON string) back to its raw key. */
function keyFromPropertyName(node: SyntaxNode, state: EditorState): string {
  const raw = state.doc.sliceString(node.from, node.to);
  try {
    return JSON.parse(raw) as string;
  } catch {
    // A half-typed or malformed key still deserves a best-effort label.
    return raw.replace(/^"|"$/g, "");
  }
}

/** Index of `child` among the value elements of its parent `Array` node. */
function indexInArray(array: SyntaxNode, child: SyntaxNode): number {
  let idx = 0;
  for (let c = array.firstChild; c != null; c = c.nextSibling) {
    if (c.from === child.from && c.to === child.to) return idx;
    if (VALUE_NODES.has(c.name)) idx++;
  }
  return idx;
}

/**
 * The path from the document root to the member on the caret's line, or `null`
 * when the document has no JSON tree (a different language, or empty). An empty
 * array means the caret sits at the root value itself.
 *
 * A caret exactly on a token uses that token. A caret in a line's whitespace
 * resolves to the enclosing object or array, so it's re-anchored to the first
 * non-whitespace character on that line — in pretty-printed JSON each member
 * starts its own line, so that's the member's own token. This tracks "the line
 * I'm on" without guessing between neighbouring keys.
 *
 * From the anchor, each ancestor contributes a segment: a `Property` its key, a
 * value directly inside an `Array` its index. Collected deepest-first, reversed.
 */
export function jsonPathSegmentsAt(state: EditorState, pos: number): JsonPathSegment[] | null {
  const tree = syntaxTree(state);
  if (tree.topNode.name !== "JsoncText") return null;

  let node: SyntaxNode = tree.resolveInner(pos, -1);
  if (CONTAINER_NODES.has(node.name)) {
    const line = state.doc.lineAt(pos);
    const indent = line.text.length - line.text.trimStart().length;
    if (indent < line.text.length) {
      node = tree.resolveInner(line.from + indent, 1);
    }
  }

  const segments: JsonPathSegment[] = [];
  let cur: SyntaxNode | null = node;
  while (cur != null) {
    const parent: SyntaxNode | null = cur.parent;
    if (cur.name === "Property") {
      const nameNode = cur.getChild("PropertyName");
      if (nameNode != null) {
        segments.push({ kind: "key", key: keyFromPropertyName(nameNode, state) });
      }
    } else if (parent != null && parent.name === "Array" && VALUE_NODES.has(cur.name)) {
      segments.push({ kind: "index", index: indexInArray(parent, cur) });
    }
    cur = parent;
  }

  segments.reverse();
  return segments;
}

const BARE_KEY = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** A single segment as JSONPath, choosing dot vs. bracket form for a key. */
function segmentToJsonPath(segment: JsonPathSegment): string {
  if (segment.kind === "index") return `[${segment.index}]`;
  // jsonpath-plus interprets a bare `$` as its root operator.
  if (BARE_KEY.test(segment.key) && segment.key !== "$") return `.${segment.key}`;
  // Anything with a dot, space, quote, etc. must be a quoted bracket accessor.
  // JSON.stringify gives correct double-quoting and escaping, matching the
  // convention the JSONPath filter box already displays.
  return `[${JSON.stringify(segment.key)}]`;
}

/**
 * Build a JSONPath expression for the first `count` segments (all of them by
 * default). `segmentsToJsonPath([])` is the root, `$`.
 */
export function segmentsToJsonPath(segments: JsonPathSegment[], count = segments.length): string {
  return "$" + segments.slice(0, count).map(segmentToJsonPath).join("");
}
