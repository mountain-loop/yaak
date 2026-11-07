export * from "./bindings/query";
import type { Completions, Diagnostic, Document, Node, Schema, Token } from "./bindings/query";
import {
  QueryMatcher as WasmQueryMatcher,
  parse_query,
  query_completions,
  query_diagnostics,
  query_format_field,
  query_tokens,
} from "./pkg";

// Every span and offset here counts UTF-16 code units, like JavaScript strings do.

/** The parsed tree, or `null` when the query has no terms */
export function parseQuery(input: string): Node | null {
  return parse_query(input) as Node | null;
}

/** Highlighting spans, in order */
export function queryTokens(input: string): Token[] {
  return query_tokens(input) as Token[];
}

/**
 * What can complete the term at `cursor`: field names, or after `@field:` the values given for
 * that field in `values`
 */
export function queryCompletions(
  input: string,
  cursor: number,
  schema: Schema,
  values?: Record<string, string[]>,
): Completions | null {
  return query_completions(input, cursor, schema, values ?? {}) as Completions | null;
}

/** The terms the schema cannot run: unknown fields and values that cannot apply */
export function queryDiagnostics(input: string, schema: Schema): Diagnostic[] {
  return query_diagnostics(input, schema) as Diagnostic[];
}

/** `@field:value` (or `-@field:value`), with the value quoted when it needs to be */
export function formatField(field: string, value: string, negated = false): string {
  return query_format_field(field, value, negated);
}

/** The length that marks a cell with no value (`Table::NO_VALUE` in the crate) */
const NO_VALUE = 0xffffffff;

/** A query parsed once, to match against many documents */
export class QueryMatcher {
  readonly #inner: WasmQueryMatcher;

  constructor(input: string, schema: Schema) {
    this.#inner = new WasmQueryMatcher(input, schema);
  }

  /** The query has no terms, so it matches everything */
  get isEmpty(): boolean {
    return this.#inner.isEmpty;
  }

  matches(doc: Document): boolean {
    return this.#inner.matches(JSON.stringify(doc));
  }

  /**
   * The indexes of the matching rows, for many documents in one call. `cells` is flat: for
   * each row, its free text, then a value (or `null` when it has none) for each of `columns`
   */
  matchingRows(columns: string[], cells: (string | null)[]): Uint32Array {
    // Packed as one string plus each cell's length, which crosses into wasm far faster than
    // JSON: nothing to escape or parse, and the cells are read in place
    const lengths = new Uint32Array(cells.length);
    for (let i = 0; i < cells.length; i++) {
      lengths[i] = cells[i]?.length ?? NO_VALUE;
    }
    return this.#inner.matchingRows(columns, cells.join(""), lengths);
  }

  /** Frees the parsed query now rather than when it is garbage collected */
  free() {
    this.#inner.free();
  }
}
