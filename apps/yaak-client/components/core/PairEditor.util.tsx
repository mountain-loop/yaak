import { generateId } from "../../lib/generateId";
import type { Pair, PairWithId } from "./PairEditor";

// NOTE: Generic so callers keep whatever they passed in (eg. an EditablePair stays editable)
export function ensurePairId<T extends Pair>(p: T): T & PairWithId {
  if (typeof p.id === "string") {
    return p as T & PairWithId;
  }
  return { ...p, id: p.id ?? generateId() };
}
