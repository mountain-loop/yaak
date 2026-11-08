import type { Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { autocompletion, startCompletion } from "@codemirror/autocomplete";

export interface FieldDef {
  name: string;
  // Optional static or dynamic value suggestions for this field
  values?: string[] | (() => string[]);
  info?: string;
}

export interface FilterOptions {
  fields: FieldDef[] | null; // e.g., ['method','status','path'] or [{name:'tag', values:()=>cachedTags}]
  /** Written before a field name, `@` by default: `@method:`. Empty for `host:` */
  fieldPrefix?: string;
  /**
   * A prefix that negates a term, such as `!`: offered where a field name is, and a term may
   * start with it before its field name
   */
  negation?: { prefix: string; info?: string };
  /**
   * Value suggestions replace only what follows the field's colon, so `host:api` offers hosts
   * matching `api`. Off, they replace the whole term
   */
  replaceValueOnly?: boolean;
}

const FIELD_IDENT = /[A-Za-z0-9_/]+$/;
const VALUE_IDENT = /\S+$/;
const VALUE_IDENT_ONLY = /^\S+$/;

function normalizeFields(fields: FieldDef[]): {
  fieldNames: string[];
  fieldMap: Record<string, { values?: string[] | (() => string[]); info?: string }>;
} {
  const fieldNames: string[] = [];
  const fieldMap: Record<string, { values?: string[] | (() => string[]); info?: string }> = {};
  for (const f of fields) {
    fieldNames.push(f.name);
    fieldMap[f.name] = { values: f.values, info: f.info };
  }
  return { fieldNames, fieldMap };
}

function wordBefore(
  doc: string,
  pos: number,
  pattern: RegExp,
): { from: number; to: number; text: string } | null {
  const upto = doc.slice(0, pos);
  const m = upto.match(pattern);
  if (!m) return null;
  const from = pos - m[0].length;
  return { from, to: pos, text: m[0] };
}

function fieldCompletionFrom(
  doc: string,
  pos: number,
  fieldPrefix = "@",
  negation?: string,
): { from: number; includeAt: boolean; negated: boolean } | null {
  const w = wordBefore(doc, pos, FIELD_IDENT);
  let from = w?.from ?? pos;
  const atTermStart = (at: number) => {
    const before = doc[at - 1];
    return at === 0 || (before != null && /\s/.test(before));
  };
  let negated = false;
  if (negation != null && doc.slice(0, from).endsWith(negation)) {
    from -= negation.length;
    negated = true;
  }

  if (atTermStart(from)) {
    return { from, includeAt: true, negated };
  }

  if (fieldPrefix !== "" && doc.slice(0, from).endsWith(fieldPrefix)) {
    if (atTermStart(from - fieldPrefix.length)) {
      return { from, includeAt: false, negated };
    }
  }

  return null;
}

/** Inside a quote, opened and not yet closed */
function inUnclosedQuote(doc: string, pos: number): boolean {
  let quotes = 0;
  for (let i = 0; i < pos; i++) {
    if (doc[i] === '"' && doc[i - 1] !== "\\") quotes++;
  }
  return quotes % 2 === 1; // odd = inside an open quote
}

/**
 * Heuristic context detector (works without relying on exact node names):
 * - If there's a ':' after the last whitespace and before the cursor, we're in a field value.
 * - Otherwise, we're in a field name or bare term position.
 */
function contextInfo(stateDoc: string, pos: number) {
  const lastColon = stateDoc.lastIndexOf(":", pos - 1);
  const lastBoundary = Math.max(
    stateDoc.lastIndexOf(" ", pos - 1),
    stateDoc.lastIndexOf("\t", pos - 1),
    stateDoc.lastIndexOf("\n", pos - 1),
    stateDoc.lastIndexOf("(", pos - 1),
    stateDoc.lastIndexOf(")", pos - 1),
  );

  const inValue = lastColon > lastBoundary;

  let fieldName: string | null = null;
  let emptyAfterColon = false;

  if (inValue) {
    // word before the colon = field name
    const beforeColon = stateDoc.slice(0, lastColon);
    const m = beforeColon.match(FIELD_IDENT);
    fieldName = m ? m[0] : null;

    // nothing (or only spaces) typed after the colon?
    const after = stateDoc.slice(lastColon + 1, pos);
    emptyAfterColon = after.length === 0 || /^\s+$/.test(after);
  }

  return { inValue, fieldName, lastColon, emptyAfterColon };
}

/** Build a completion list for field names */
function fieldNameCompletions(
  fieldNames: string[],
  includeAt: boolean,
  fieldPrefix = "@",
  fieldMap: Record<string, { info?: string }> = {},
  negated = "",
): Completion[] {
  return fieldNames.map((name) => ({
    label: `${negated}${name}`,
    type: "property",
    info: fieldMap[name]?.info,
    apply: (view, _completion, from, to) => {
      // Leave cursor right after the field filter colon.
      const insert = `${negated}${includeAt ? fieldPrefix : ""}${name}:`;
      view.dispatch({
        changes: { from, to, insert },
        selection: { anchor: from + insert.length },
      });
      startCompletion(view);
    },
  }));
}

/** Build a completion list for field values (if provided) */
function fieldValueCompletions(
  def: { values?: string[] | (() => string[]); info?: string } | undefined,
): Completion[] | null {
  if (!def || !def.values) return null;
  const vals = Array.isArray(def.values) ? def.values : def.values();
  return vals.map((v) => ({
    label: v.match(VALUE_IDENT_ONLY) ? v : `"${v}"`,
    displayLabel: v,
    type: "constant",
  }));
}

/** Offers the negation prefix itself, reopening the list for a field name after it */
function negationCompletion(negation: { prefix: string; info?: string }): Completion {
  return {
    label: negation.prefix,
    type: "keyword",
    info: negation.info,
    apply: (view, _completion, from, to) => {
      view.dispatch({
        changes: { from, to, insert: negation.prefix },
        selection: { anchor: from + negation.prefix.length },
      });
      startCompletion(view);
    },
  };
}

/** The main completion source */
export function makeCompletionSource(opts: FilterOptions) {
  const { fieldNames, fieldMap } = normalizeFields(opts.fields ?? []);
  return (ctx: CompletionContext): CompletionResult | null => {
    const { state, pos } = ctx;
    const doc = state.doc.toString();

    if (inUnclosedQuote(doc, pos)) {
      return null;
    }

    const { inValue, fieldName, lastColon, emptyAfterColon } = contextInfo(doc, pos);

    // In field value position
    if (inValue && fieldName) {
      const w = wordBefore(doc, pos, VALUE_IDENT);
      const from = opts.replaceValueOnly ? lastColon + 1 : (w?.from ?? pos);
      const to = pos;
      const valDefs = fieldMap[fieldName];
      const vals = fieldValueCompletions(valDefs);

      // If user hasn't typed a value char yet:
      // - Show value suggestions if available
      // - Otherwise show nothing (no fallback to field names)
      if (emptyAfterColon) {
        if (vals?.length) {
          return { from, to, options: vals, filter: true };
        }
        return null; // <-- key change: do not suggest fields here
      }

      // User started typing a value; filter value suggestions (if any)
      if (vals?.length) {
        return { from, to, options: vals, filter: true };
      }
      // No specific values: also show nothing (keeps UI quiet)
      return null;
    }

    // Not in a value: suggest field names (and maybe boolean ops)
    const completion = fieldCompletionFrom(doc, pos, opts.fieldPrefix, opts.negation?.prefix);
    if (completion == null) return null;
    const { from, includeAt, negated } = completion;
    const to = pos;
    const options: Completion[] = fieldNameCompletions(
      fieldNames,
      includeAt,
      opts.fieldPrefix,
      fieldMap,
      negated ? (opts.negation?.prefix ?? "") : "",
    );
    if (opts.negation != null && !negated) options.push(negationCompletion(opts.negation));

    return { from, to, options, filter: true };
  };
}

/**
 * Field and value suggestions, as the sidebar's filter offers them, for a field of another
 * language: a plain input of `host:` and `app:` entries, say
 */
export function filterAutocomplete(options: FilterOptions) {
  return autocompletion({ override: [makeCompletionSource(options)] });
}
