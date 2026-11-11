import type { Completion } from "@codemirror/autocomplete";
import type { QueryDiagnostic, SavedQuery } from "@yaakapp-internal/proxy-lib";
import type { QueryProblem } from "@yaakapp-internal/ui/editor";
import { asOneTerm } from "./query";
import { rpc } from "./rpc";

/** How long values read for completion are offered before they are read again */
const VALUES_MS = 10_000;

const seenValues = new Map<string, { values: string[]; at: number }>();
const reading = new Map<string, Promise<string[]>>();

/**
 * The values the proxy has seen for field paths, for completing them: read from the database
 * the first time each is asked for, and again once they are a few seconds old, so the list
 * keeps up with the traffic without a read per keystroke.
 */
export async function loadSeenValues(paths: string[]): Promise<Record<string, string[]>> {
  const now = Date.now();
  const entries = await Promise.all(
    paths.map(async (path): Promise<[string, string[]]> => {
      const cached = seenValues.get(path);
      if (cached != null && now - cached.at < VALUES_MS) return [path, cached.values];
      let read = reading.get(path);
      if (read == null) {
        read = rpc("query_values", { path })
          .then((values) => {
            seenValues.set(path, { values, at: Date.now() });
            return values;
          })
          .catch(() => cached?.values ?? [])
          .finally(() => reading.delete(path));
        reading.set(path, read);
      }
      return [path, await read];
    }),
  );
  return Object.fromEntries(entries);
}

const PROBLEM_LABELS: Record<QueryDiagnostic["kind"], string> = {
  unknownField: "Unknown field",
  invalidValue: "Invalid value",
  notYet: "Not supported",
};

/** The terms of a search the backend cannot run, as the box underlines them */
export function problemsOf(diagnostics: QueryDiagnostic[]): QueryProblem[] {
  return diagnostics.map((d) => ({
    from: d.start,
    to: d.end,
    label: PROBLEM_LABELS[d.kind],
    quiet: d.kind === "notYet",
  }));
}

export async function searchProblems(text: string): Promise<QueryProblem[]> {
  if (text.trim() === "") return [];
  return problemsOf(await rpc("validate_query", { query: text }));
}

/**
 * Saved searches whose names hold the word being typed, each replacing it with its search. One
 * with `OR` at its top goes in parentheses, so it stays one group beside the box's other terms.
 */
export function savedCompletions(saved: SavedQuery[], typed: string): Completion[] {
  const needle = typed.toLowerCase();
  return saved
    .filter((s) => s.name.toLowerCase().includes(needle))
    .map((s) => {
      const insert = asOneTerm(s.query);
      return {
        label: s.name,
        detail: s.query,
        type: "text",
        apply: insert,
      };
    });
}
