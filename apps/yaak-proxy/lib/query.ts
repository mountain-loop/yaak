import type { Node } from "@yaakapp-internal/query";
import { formatField, parseQuery } from "@yaakapp-internal/query";

/**
 * A search over every flow in the database, as `list_flows` takes it: the search box's text,
 * which the backend parses and runs, and whether System's flows are hidden.
 */
export interface FlowQuery {
  query: string;
  hideSystem: boolean;
}

/** The search the list shows, or null for all traffic */
export function activeQuery(text: string, hideSystem: boolean): FlowQuery | null {
  if (text.trim() === "" && !hideSystem) return null;
  return { query: text.trim(), hideSystem };
}

/** `@field:value`, or `-@field:value`, the value quoted when it needs to be */
export function fieldTerm(field: string, value: string, negated = false): string {
  return formatField(field, value, negated);
}

/** A site, its domain and every host below it: `@host:*.github.com` */
export function siteTerm(site: string): string {
  const term = formatField("host", site);
  return term.endsWith('"') ? term : `@host:*.${site}`;
}

/**
 * A path and everything under it, `@path:/v1/charges/*`, as a sidebar row selects it. A path
 * that has to be quoted cannot carry the wildcard, so it matches as written.
 */
export function pathTerm(path: string): string {
  const term = formatField("path", path);
  if (term.endsWith('"')) return term;
  return `${term.replace(/\/+$/, "")}/*`;
}

/** `node` written back as query text, from its source, groups in parentheses where they need */
export function nodeText(node: Node, source: string, nested = false): string {
  switch (node.type) {
    case "And": {
      const text = node.children.map((c) => nodeText(c, source, true)).join(" ");
      return nested ? `(${text})` : text;
    }
    case "Or": {
      const text = node.children.map((c) => nodeText(c, source, true)).join(" OR ");
      return nested ? `(${text})` : text;
    }
    case "Not":
      return `-${nodeText(node.node, source, true)}`;
    default:
      return source.slice(node.span.start, node.span.end);
  }
}

/** The terms of a query, each as written and with a `-` when it is excluded, lowercased */
export function termKeys(text: string): string[] {
  const root = parseQuery(text);
  return root == null ? [] : nodeKeys(root, text);
}

/**
 * A query's shape, for telling whether two say the same: its terms lowercased, with its `AND`
 * and `OR` groups kept apart and their members in a set's order. Null for an empty query.
 */
export function queryShape(text: string): string | null {
  const root = parseQuery(text);
  return root == null ? null : shapeOf(root, text);
}

/**
 * The shape of each group `OR` separates at the top of a query: one for a query with no `OR`
 * there, none for an empty one
 */
export function orGroupShapes(text: string): string[] {
  const root = parseQuery(text);
  if (root == null) return [];
  const groups = root.type === "Or" ? root.children : [root];
  return groups.map((g) => shapeOf(g, text));
}

function shapeOf(node: Node, text: string): string {
  switch (node.type) {
    case "And":
    case "Or": {
      const members = [...new Set(node.children.map((c) => shapeOf(c, text)))].sort();
      return `${node.type}(${members.join(",")})`;
    }
    case "Not":
      return `-${shapeOf(node.node, text)}`;
    default:
      return text.slice(node.span.start, node.span.end).toLowerCase();
  }
}

function nodeKeys(node: Node, text: string): string[] {
  const keys: string[] = [];
  const walk = (node: Node, negated: boolean) => {
    switch (node.type) {
      case "And":
      case "Or":
        for (const c of node.children) walk(c, negated);
        break;
      case "Not":
        walk(node.node, !negated);
        break;
      default:
        keys.push(
          `${negated ? "-" : ""}${text.slice(node.span.start, node.span.end).toLowerCase()}`,
        );
    }
  };
  walk(node, false);
  return keys;
}

/**
 * Wider searches for one that matched nothing: the text with each of its terms left out in
 * turn, without repeats. With groups `OR` separates, a term is left out of one group at a time
 * and the groups kept, since each group alone is narrower still; a group left with nothing would
 * take in every flow, so it is not offered.
 */
export function widerQueries(text: string): string[] {
  const root = parseQuery(text);
  if (root == null) return [];
  const clauses = root.type === "Or" ? root.children : [root];
  const termsOf = (clause: Node) => (clause.type === "And" ? clause.children : [clause]);
  const write = (terms: Node[]) => terms.map((t) => nodeText(t, text, true)).join(" ");
  const out = new Set<string>();
  clauses.forEach((clause, i) => {
    const terms = termsOf(clause);
    if (terms.length <= 1) return;
    terms.forEach((_, j) => {
      const wider = clauses.map((c, k) =>
        k === i ? write(terms.filter((_, l) => l !== j)) : write(termsOf(c)),
      );
      out.add(wider.join(" OR "));
    });
  });
  return [...out];
}

/**
 * The search has a `@time` term that counts back from now, `@time:<5m`, so which flows it covers
 * changes as time passes, not only as flows are written
 */
export function countsBackFromNow(text: string): boolean {
  let found = false;
  const walk = (node: Node) => {
    switch (node.type) {
      case "And":
      case "Or":
        for (const c of node.children) walk(c);
        break;
      case "Not":
        walk(node.node);
        break;
      case "Field":
        if (
          node.path.length === 1 &&
          node.path[0]?.toLowerCase() === "time" &&
          (node.value.type === "compare" || node.value.type === "range")
        ) {
          found = true;
        }
        break;
      default:
    }
  };
  const root = parseQuery(text);
  if (root != null) walk(root);
  return found;
}

/** Any of the searches counts back from now, so its count changes as time passes */
export function anyCountsBackFromNow(queries: string[]): boolean {
  return queries.some(countsBackFromNow);
}

/** `text` to sit beside other terms as one: in parentheses when it is an `OR` at its top */
export function asOneTerm(text: string): string {
  return parseQuery(text)?.type === "Or" ? `(${text})` : text;
}
