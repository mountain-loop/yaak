import { atom } from 'jotai';
import { atomFamily } from 'jotai/utils';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const collapsedFamily = atomFamily((_: string) => {
  return atom<Record<string, boolean>>({});
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const selectedFamily = atomFamily((_: string) => {
  return atom<string[]>([]);
});
