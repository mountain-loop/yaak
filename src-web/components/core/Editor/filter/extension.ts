import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import { autocompletion, startCompletion } from '@codemirror/autocomplete';
import { LanguageSupport, LRLanguage, syntaxTree } from '@codemirror/language';
import { parser } from './filter';

export interface FieldDef {
  name: string;
  // Optional static or dynamic value suggestions for this field
  values?: string[] | (() => string[]);
  info?: string;
}

export interface FilterOptions {
  fields: FieldDef[] | null; // e.g., ['method','status','path'] or [{name:'tag', values:()=>cachedTags}]
}

const IDENT = /[A-Za-z0-9_/]+$/;
const IDENT_ONLY = /^[A-Za-z0-9_/]+$/;

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

function wordBefore(doc: string, pos: number): { from: number; to: number; text: string } | null {
  const upto = doc.slice(0, pos);
  const m = upto.match(IDENT);
  if (!m) return null;
  const from = pos - m[0].length;
  return { from, to: pos, text: m[0] };
}

function inPhrase(ctx: CompletionContext): boolean {
  // Lezer node names from your grammar: Phrase is the quoted token
  let n = syntaxTree(ctx.state).resolveInner(ctx.pos, -1);
  for (; n; n = n.parent!) {
    if (n.name === 'Phrase') return true;
  }
  return false;
}

// While typing an incomplete quote, there's no Phrase token yet.
function inUnclosedQuote(doc: string, pos: number): boolean {
  let quotes = 0;
  for (let i = 0; i < pos; i++) {
    if (doc[i] === '"' && doc[i - 1] !== '\\') quotes++;
  }
  return quotes % 2 === 1; // odd = inside an open quote
}

/**
 * Heuristic context detector (works without relying on exact node names):
 * - If there's a ':' after the last whitespace and before the cursor, we're in a field value.
 * - Otherwise, we're in a field name or bare term position.
 */
function contextInfo(stateDoc: string, pos: number) {
  const lastColon = stateDoc.lastIndexOf(':', pos - 1);
  const lastBoundary = Math.max(
    stateDoc.lastIndexOf(' ', pos - 1),
    stateDoc.lastIndexOf('\t', pos - 1),
    stateDoc.lastIndexOf('\n', pos - 1),
    stateDoc.lastIndexOf('(', pos - 1),
    stateDoc.lastIndexOf(')', pos - 1),
  );

  const inValue = lastColon > lastBoundary;

  let fieldName: string | null = null;
  let emptyAfterColon = false;

  if (inValue) {
    // word before the colon = field name
    const beforeColon = stateDoc.slice(0, lastColon);
    const m = beforeColon.match(IDENT);
    fieldName = m ? m[0] : null;

    // nothing (or only spaces) typed after the colon?
    const after = stateDoc.slice(lastColon + 1, pos);
    emptyAfterColon = after.length === 0 || /^\s+$/.test(after);
  }

  return { inValue, fieldName, lastColon, emptyAfterColon };
}

/** Build a completion list for field names */
function fieldNameCompletions(fieldNames: string[]): Completion[] {
  return fieldNames.map((name) => ({
    label: name,
    type: 'property',
    apply: (view, _completion, from, to) => {
      // Insert "name:" (leave cursor right after colon)
      view.dispatch({
        changes: { from, to, insert: `${name}:` },
        selection: { anchor: from + name.length + 1 },
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
    label: v.match(IDENT_ONLY) ? v : `"${v}"`,
    displayLabel: v,
    type: 'constant',
  }));
}

/** The main completion source */
function makeCompletionSource(opts: FilterOptions) {
  const { fieldNames, fieldMap } = normalizeFields(opts.fields ?? []);
  return (ctx: CompletionContext): CompletionResult | null => {
    const { state, pos } = ctx;
    const doc = state.doc.toString();

    if (inPhrase(ctx) || inUnclosedQuote(doc, pos)) {
      return null;
    }

    const w = wordBefore(doc, pos);
    const from = w?.from ?? pos;
    const to = pos;

    const { inValue, fieldName, emptyAfterColon } = contextInfo(doc, pos);

    // In field value position
    if (inValue && fieldName) {
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
    const options: Completion[] = fieldNameCompletions(fieldNames);

    return { from, to, options, filter: true };
  };
}

const language = LRLanguage.define({
  name: 'filter',
  parser,
  languageData: {
    autocompletion: {},
  },
});

/** Public extension */
export function filter(options: FilterOptions) {
  const source = makeCompletionSource(options);
  return new LanguageSupport(language, [autocompletion({ override: [source] })]);
}
