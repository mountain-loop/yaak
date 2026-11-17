/**
 * The search box composes a filter, then applies it, as Yaak's URL bar composes a request: the
 * draft is what the box holds, the applied filter what the list shows.
 */
export interface FilterBox {
  draft: string;
  applied: string;
}

/** What a key does to the box: its text from now, and a filter to apply, or null for none */
export interface BoxStep {
  draft: string;
  apply: string | null;
  /** Applied with Enter, so kept in the filter history */
  record: boolean;
}

/** The draft differs from what is applied, so Enter has something to do */
export function isUnapplied(box: FilterBox): boolean {
  return box.draft.trim() !== box.applied.trim();
}

/** Enter applies the draft, kept in the history unless it is blank */
export function pressEnter(box: FilterBox): BoxStep {
  const apply = box.draft.trim();
  return { draft: box.draft, apply, record: apply !== "" };
}

/**
 * Escape puts the applied filter back over an unapplied draft; with nothing unapplied, it clears
 * the filter. Null when it has nothing to do, so the key goes on to whatever else wants it.
 */
export function pressEscape(box: FilterBox): BoxStep | null {
  if (isUnapplied(box)) return { draft: box.applied, apply: null, record: false };
  if (box.applied.trim() !== "") return { draft: "", apply: "", record: false };
  return null;
}

/** Something outside the box sets the filter, applying it at once */
export function applyFromOutside(text: string): BoxStep {
  return { draft: text, apply: text, record: false };
}

/**
 * Where Up and Down are in the filter history: `index` into it, newest first, and the text it
 * put in the box, so typing over it ends the stepping
 */
export interface Recall {
  index: number;
  text: string;
}

/**
 * Up in an empty box puts the latest filter applied in it, and each Up after an older one; Down
 * steps back toward the newest, then empties the box. Null when the key is not for stepping:
 * the box holds text of its own, or there is nowhere to go.
 */
export function stepHistory(
  history: string[],
  recall: Recall | null,
  draft: string,
  key: "up" | "down",
): { recall: Recall | null; draft: string } | null {
  const stepping = recall != null && recall.text === draft;
  if (!stepping) {
    if (key === "down" || draft !== "") return null;
    const first = history[0];
    return first == null ? null : { recall: { index: 0, text: first }, draft: first };
  }
  const index = recall.index + (key === "up" ? 1 : -1);
  if (index < 0) return { recall: null, draft: "" };
  const text = history[index];
  // At the oldest, Up stays put.
  if (text == null) return { recall, draft };
  return { recall: { index, text }, draft: text };
}
