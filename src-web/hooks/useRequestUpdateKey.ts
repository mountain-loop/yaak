import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import type { ModelPayload } from '@yaakapp-internal/models';
import { atom, useAtomValue } from 'jotai';
import { generateId } from '../lib/generateId';
import { jotaiStore } from '../lib/jotai';

const requestUpdateKeyAtom = atom<Record<string, string>>({});

getCurrentWebviewWindow()
  .listen<ModelPayload>('upserted_model', ({ payload }) => {
    if (
      (payload.model.model === 'http_request' ||
        payload.model.model === 'grpc_request' ||
        payload.model.model === 'websocket_request') &&
      ((payload.updateSource.type === 'window' &&
        payload.updateSource.label !== getCurrentWebviewWindow().label) ||
        payload.updateSource.type !== 'window')
    ) {
      wasUpdatedExternally(payload.model.id);
    }
  })
  .catch(console.error);

export function wasUpdatedExternally(changedRequestId: string) {
  jotaiStore.set(requestUpdateKeyAtom, (m) => ({ ...m, [changedRequestId]: generateId() }));
}

export function useRequestUpdateKey(requestId: string | null) {
  const keys = useAtomValue(requestUpdateKeyAtom);
  const key = keys[requestId ?? 'n/a'];
  return `${requestId}::${key ?? 'default'}`;
}
