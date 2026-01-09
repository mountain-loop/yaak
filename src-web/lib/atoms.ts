import deepEqual from '@gilbarbara/deep-equal';
import type { UpdateInfo } from '@yaakapp-internal/tauri';
import type { Atom } from 'jotai';
import { atom } from 'jotai';
import { selectAtom } from 'jotai/utils';
import type { SplitLayoutLayout } from '../components/core/SplitLayout';
import { atomWithKVStorage } from './atoms/atomWithKVStorage';

export function deepEqualAtom<T>(a: Atom<T>) {
  return selectAtom(
    a,
    (v) => v,
    (a, b) => deepEqual(a, b),
  );
}

export const workspaceLayoutAtom = atomWithKVStorage<SplitLayoutLayout>(
  'workspace_layout',
  'horizontal',
);

export const updateAvailableAtom = atom<Omit<UpdateInfo, 'replyEventId'> | null>(null);
