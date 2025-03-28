import { atom, useAtomValue } from 'jotai';
import { generateId } from '../lib/generateId';
import { jotaiStore } from '../lib/jotai';

const requestUpdateKeyAtom = atom<Record<string, string>>({});

export function wasUpdatedExternally(changedRequestId: string) {
  jotaiStore.set(requestUpdateKeyAtom, (m) => ({ ...m, [changedRequestId]: generateId() }));
}

export function useRequestUpdateKey(requestId: string | null) {
  const keys = useAtomValue(requestUpdateKeyAtom);
  const key = keys[requestId ?? 'n/a'];
  return `${requestId}::${key ?? 'default'}`;
}
