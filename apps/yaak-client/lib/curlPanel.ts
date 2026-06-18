import { atom } from "jotai";
import { jotaiStore } from "./jotai";

export const curlPanelRequestIdAtom = atom<string | null>(null);

export function showCurlPanel(requestId: string) {
  jotaiStore.set(curlPanelRequestIdAtom, requestId);
}

export function hideCurlPanel() {
  jotaiStore.set(curlPanelRequestIdAtom, null);
}
