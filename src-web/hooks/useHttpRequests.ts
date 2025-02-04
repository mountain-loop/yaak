import type {HttpRequest} from '@yaakapp-internal/models';
import {atom, useAtomValue} from 'jotai';
import {jotaiStore} from "../lib/jotai";

export const httpRequestsAtom = atom<HttpRequest[]>([]);

export function useHttpRequests() {
    return useAtomValue(httpRequestsAtom);
}

export function getHttpRequest(id: string) {
    return jotaiStore.get(httpRequestsAtom).find(r => r.id === id) ?? null;
}
