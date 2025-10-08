import { createFileRoute } from '@tanstack/react-router';
import classNames from 'classnames';
import { atom, useAtomValue } from 'jotai';
import type { ContextMenuProps } from '../../components/core/Dropdown';
import { HttpMethodTagRaw } from '../../components/core/HttpMethodTag';
import type { TreeNode } from '../../components/core/tree/common';
import { Tree } from '../../components/core/tree/Tree';
import { jotaiStore } from '../../lib/jotai';

export const Route = createFileRoute('/design/')({
  component: RouteComponent,
});

interface Dummy {
  id: string;
  model: 'folder' | 'request' | 'workspace';
  name: string;
  method?: string;
}

const root: TreeNode<Dummy> = {
  icon: 'folder',
  item: { id: 'root', name: 'Workspace', model: 'workspace' },
  children: [
    {
      icon: 'folder',
      item: { id: 'f1', model: 'folder', name: 'Folder 1' },
      children: [
        {
          item: { id: 'r1', model: 'request', name: 'Request 1', method: 'GET' },
        },
        {
          item: { id: 'r2', model: 'request', name: 'Request 2', method: 'POST' },
        },
        {
          icon: 'folder',
          item: { id: 'f3', model: 'folder', name: 'Folder 3' },
          children: [
            {
              item: { id: 'r3', model: 'request', name: 'Request 3', method: 'PUT' },
            },
            {
              icon: 'folder',
              item: { id: 'f4', model: 'folder', name: 'Folder 4' },
              children: [
                {
                  item: { id: 'r4', model: 'request', name: 'Request 4', method: 'DELETE' },
                },
                {
                  item: { id: 'r5', model: 'request', name: 'Request 5', method: 'PATCH' },
                },
                {
                  item: { id: 'r11', model: 'request', name: 'Request 11', method: 'OPTIONS' },
                },
                {
                  item: { id: 'r12', model: 'request', name: 'Request 12', method: 'GRAPHQL' },
                },
              ],
            },
          ],
        },
      ],
    },
    {
      icon: 'folder',
      item: { id: 'f2', model: 'folder', name: 'Folder 2' },
      children: [
        {
          item: { id: 'r6', model: 'request', name: 'Auth: Login', method: 'POST' },
        },
        {
          item: { id: 'r7', model: 'request', name: 'Auth: Logout', method: 'DELETE' },
        },
        {
          icon: 'folder',
          item: { id: 'f5', model: 'folder', name: 'Subfolder A' },
          children: [
            {
              item: { id: 'r8', model: 'request', name: 'Nested Request 1', method: 'GET' },
            },
            {
              item: { id: 'r9', model: 'request', name: 'Nested Request 2', method: 'POST' },
            },
          ],
        },
      ],
    },
    {
      icon: 'folder',
      item: { id: 'f6', model: 'folder', name: 'Folder 3 (Empty)' },
      children: [],
    },
    {
      item: { id: 'r10', model: 'request', name: 'Top-level Request', method: 'GET' },
    },
  ],
};

const activeIdAtom = atom<string | null>('r2');
const activeAtom = atom<Dummy | null>(null);

function RouteComponent() {
  const active = useAtomValue(activeAtom);
  return (
    <div className="h-full w-full grid grid-rows-1 grid-cols-[auto_1fr]">
      <div className="pl-3 pt-12 w-[24rem] border-r border-border-subtle h-full pr-1.5 x-theme-sidebar bg-surface pb-3">
        <Tree
          treeId={root.item.id}
          root={root}
          getItemKey={getItemKey}
          renderItem={renderItem}
          activeIdAtom={activeIdAtom}
          getContextMenu={getContextMenu}
          onActivate={handleActivate}
        />
      </div>
      <div className="p-6">{active?.name ?? 'Nothing Selected'}</div>
    </div>
  );
}

function handleActivate(items: Dummy[]) {
  const item = items[0] ?? null;
  jotaiStore.set(activeIdAtom, item?.id ?? null);
  jotaiStore.set(activeAtom, item);
}

function getContextMenu(items: Dummy[]): ContextMenuProps['items'] {
  return [
    {
      label: 'Testing 123',
      onSelect: () => {
        console.log('CONTEXT Testing', items);
      },
    },
    {
      label: 'Testing 456',
      onSelect: () => {
        console.log('CONTEXT Testing again', items);
      },
    },
  ];
}

function getItemKey(item: Dummy) {
  return item.id;
}

function renderItem(item: Dummy) {
  const isSelected = item.id === jotaiStore.get(activeIdAtom);
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-2 h-full">
      {item.method && (
        <HttpMethodTagRaw
          short
          className={classNames('text-editor', !isSelected && 'opacity-80')}
          method={item.method}
          colored={true}
        />
      )}{' '}
      <div className="truncate">{item.name}</div>
    </div>
  );
}
