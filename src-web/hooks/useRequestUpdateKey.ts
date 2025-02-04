import { atom, useAtomValue } from 'jotai';
import { generateId } from '../lib/generateId';
import { jotaiStore } from '../lib/jotai';

const keyAtom = atom<Record<string, string>>({});

export function useRequestUpdateKey(requestId: string | null) {
  const keys = useAtomValue(keyAtom);
  const key = keys[requestId ?? 'n/a'];
  return {
    updateKey: `${requestId}::${key ?? 'default'}`,
    wasUpdatedExternally: (changedRequestId: string) => {
      jotaiStore.set(keyAtom, (m) => ({ ...m, [changedRequestId]: generateId() }));
    },
  };
}
