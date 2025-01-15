import type { Settings } from '@yaakapp-internal/models';
import { useAtomValue } from 'jotai';
import { atom } from 'jotai/index';
import { getSettings } from '../lib/store';

const settings = await getSettings();
export const settingsAtom = atom<Settings>(settings);

export function useSettings() {
  return useAtomValue(settingsAtom);
}
