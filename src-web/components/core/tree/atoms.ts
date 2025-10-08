import { atom } from 'jotai';
import { atomFamily } from 'jotai/utils';
import type { IconProps } from '../Icon';

export interface TreeNode<T> {
  id: string;
  children?: TreeNode<T>[];
  icon?: IconProps['icon'];
  item: T;
}

export type FlatTreeNode<T> = Omit<TreeNode<T>, 'children'> & {
  depth: number;
  node: TreeNode<T>;
  count: number | null;
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const collapsedFamily = atomFamily((_: string) => {
  return atom<Record<string, boolean>>({});
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const selectedFamily = atomFamily((_: string) => {
  return atom<string | null>(null);
});
