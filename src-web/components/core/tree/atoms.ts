import { atom } from 'jotai';
import { atomFamily } from 'jotai/utils';
import type { IconProps } from '../Icon';

export interface TreeNode<T extends { id: string }> {
  children?: TreeNode<T>[];
  icon?: IconProps['icon'];
  item: T;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const collapsedFamily = atomFamily((_: string) => {
  return atom<Record<string, boolean>>({});
});
