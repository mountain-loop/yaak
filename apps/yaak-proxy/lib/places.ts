/** The tab open on each half of the detail card; a half left out opens on its own default */
export interface PlaceTabs {
  request?: string;
  response?: string;
}

/**
 * Where the main window is: the filter applied, the flows selected and the card's open tabs.
 * Sort, columns, layout and Hide System are preferences, not part of it.
 */
export interface Place {
  filter: string;
  /** The selected flows' ids: one at most for now */
  selection: ReadonlySet<string>;
  tabs: PlaceTabs;
}

export const EMPTY_PLACE: Place = { filter: "", selection: new Set(), tabs: {} };

/** The places Back and Forward walk, and which of them is current */
export interface PlaceStack {
  places: Place[];
  index: number;
}

/** Most places kept; adding one more forgets the oldest */
export const MAX_PLACES = 100;

export function stackOf(place: Place): PlaceStack {
  return { places: [place], index: 0 };
}

export function currentPlace(stack: PlaceStack): Place {
  return stack.places[stack.index] ?? EMPTY_PLACE;
}

export function sameSelection(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}

function sameTabs(a: PlaceTabs, b: PlaceTabs): boolean {
  return a.request === b.request && a.response === b.response;
}

/** The same filter and selection: going there again is not a new place */
export function samePlace(a: Place, b: Place): boolean {
  return a.filter === b.filter && sameSelection(a.selection, b.selection);
}

/**
 * A new place on top of the current one, dropping any ahead of it, as a deliberate jump makes.
 * One where the window already is changes the current place instead.
 */
export function addPlace(stack: PlaceStack, place: Place): PlaceStack {
  if (samePlace(currentPlace(stack), place)) return updatePlace(stack, place);
  const places = [...stack.places.slice(0, stack.index + 1), place].slice(-MAX_PLACES);
  return { places, index: places.length - 1 };
}

/** The current place changed in step, as moving with the arrow keys or switching a tab does */
export function updatePlace(stack: PlaceStack, place: Place): PlaceStack {
  const current = currentPlace(stack);
  if (samePlace(current, place) && sameTabs(current.tabs, place.tabs)) return stack;
  const places = [...stack.places];
  places[stack.index] = place;
  return { places, index: stack.index };
}

/** One place back, -1, or forward, 1, or null with none there */
export function stepPlace(stack: PlaceStack, delta: -1 | 1): PlaceStack | null {
  const index = stack.index + delta;
  if (index < 0 || index >= stack.places.length) return null;
  return { places: stack.places, index };
}

/** The place without the flows `exists` says are gone, as one restored after a clear is */
export function withoutMissing(place: Place, exists: (id: string) => boolean): Place {
  const kept = [...place.selection].filter(exists);
  if (kept.length === place.selection.size) return place;
  return { ...place, selection: new Set(kept), tabs: kept.length === 0 ? {} : place.tabs };
}

/** The place without some flows, wherever it is in the stack, as one deleted leaves them */
export function stackWithout(stack: PlaceStack, ids: ReadonlySet<string>): PlaceStack {
  let changed = false;
  const places = stack.places.map((p) => {
    const next = withoutMissing(p, (id) => !ids.has(id));
    if (next !== p) changed = true;
    return next;
  });
  return changed ? { places, index: stack.index } : stack;
}

interface StoredPlace {
  filter: string;
  selection: string[];
  tabs: PlaceTabs;
}

function storedPlace(place: Place): StoredPlace {
  return { filter: place.filter, selection: [...place.selection], tabs: place.tabs };
}

function placeFrom(value: unknown): Place | null {
  if (value == null || typeof value !== "object") return null;
  const v = value as Partial<StoredPlace>;
  if (typeof v.filter !== "string" || !Array.isArray(v.selection)) return null;
  const tabs: PlaceTabs = {};
  const t = (v.tabs ?? {}) as Record<string, unknown>;
  if (typeof t.request === "string") tabs.request = t.request;
  if (typeof t.response === "string") tabs.response = t.response;
  const selection = v.selection.filter((id): id is string => typeof id === "string");
  return { filter: v.filter, selection: new Set(selection), tabs };
}

/** The stack as kept in storage */
export function stackToJson(stack: PlaceStack): string {
  return JSON.stringify({ places: stack.places.map(storedPlace), index: stack.index });
}

/** A stack read from storage, or null for anything that isn't one */
export function stackFromJson(json: string | null): PlaceStack | null {
  if (json == null) return null;
  try {
    const value = JSON.parse(json) as { places?: unknown; index?: unknown };
    if (!Array.isArray(value.places) || typeof value.index !== "number") return null;
    const places: Place[] = [];
    for (const p of value.places.slice(0, MAX_PLACES)) {
      const place = placeFrom(p);
      if (place == null) return null;
      places.push(place);
    }
    if (places.length === 0) return null;
    const index = Math.max(0, Math.min(places.length - 1, Math.floor(value.index)));
    return { places, index };
  } catch {
    return null;
  }
}
