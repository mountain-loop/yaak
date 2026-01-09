import { generateId } from '../../lib/generateId';
import type { Pair, PairWithId } from './PairEditor';

export function ensurePairId(p: Pair): PairWithId {
  if (typeof p.id === 'string') {
    return p as PairWithId;
  }
  return { ...p, id: p.id ?? generateId() };
}
