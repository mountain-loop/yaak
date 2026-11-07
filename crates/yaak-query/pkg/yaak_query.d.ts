/* tslint:disable */
/* eslint-disable */

/**
 * A query parsed once and matched against many documents.
 */
export class QueryMatcher {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Whether a `Document` (`{ text, fields }`) matches.
     */
    matches(doc: any): boolean;
    constructor(input: string, schema: any);
    /**
     * Whether the query has no terms, so it matches everything.
     */
    readonly isEmpty: boolean;
}

/**
 * The parsed tree (`Node | null`), with UTF-16 spans.
 */
export function parse_query(input: string): any;

/**
 * `Completions | null` at UTF-16 offset `cursor`. `values` maps field paths to the values seen
 * for them (`Record<string, string[]>`).
 */
export function query_completions(input: string, cursor: number, schema: any, values: any): any;

/**
 * The terms the schema cannot run (`Diagnostic[]`), with UTF-16 spans.
 */
export function query_diagnostics(input: string, schema: any): any;

export function query_format_field(field: string, value: string, negated: boolean): string;

/**
 * Highlighting spans (`Token[]`), in UTF-16 offsets.
 */
export function query_tokens(input: string): any;
