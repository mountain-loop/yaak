import type { Settings } from '@yaakapp-internal/models';
import { useAtomValue } from 'jotai';
import { atom } from 'jotai/index';
import {jotaiStore} from "../lib/jotai";
import { invokeCmd } from '../lib/tauri';

const settings = await invokeCmd<Settings>('cmd_get_settings');
export const settingsAtom = atom<Settings>(settings);

export function useSettings() {
  return useAtomValue(settingsAtom);
}

export function getSettings() {
  return jotaiStore.get(settingsAtom);
}
