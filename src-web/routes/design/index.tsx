import { createFileRoute } from '@tanstack/react-router';
import { atom } from 'jotai';
import type { TreeNode } from '../../components/core/tree/atoms';
import { Tree } from '../../components/core/tree/Tree';
import { jotaiStore } from '../../lib/jotai';

export const Route = createFileRoute('/design/')({
  component: RouteComponent,
});

interface Dummy {
  id: string;
  model: 'folder' | 'request' | 'workspace';
  name: string;
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
          item: { id: 'r1', model: 'request', name: 'Request 1' },
        },
        {
          item: { id: 'r2', model: 'request', name: 'Request 2' },
        },
        {
          icon: 'folder',
          item: { id: 'f3', model: 'folder', name: 'Folder 3' },
          children: [
            {
              item: { id: 'r3', model: 'request', name: 'Request 3' },
            },
            {
              icon: 'folder',
              item: { id: 'f4', model: 'folder', name: 'Folder 4' },
              children: [
                {
                  item: { id: 'r4', model: 'request', name: 'Request 4' },
                },
                {
                  item: { id: 'r5', model: 'request', name: 'Request 5' },
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
          item: { id: 'r6', model: 'request', name: 'Auth: Login' },
        },
        {
          item: { id: 'r7', model: 'request', name: 'Auth: Logout' },
        },
        {
          icon: 'folder',
          item: { id: 'f5', model: 'folder', name: 'Subfolder A' },
          children: [
            {
              item: { id: 'r8', model: 'request', name: 'Nested Request 1' },
            },
            {
              item: { id: 'r9', model: 'request', name: 'Nested Request 2' },
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
      item: { id: 'r10', model: 'request', name: 'Top-level Request' },
    },
  ],
};
const selectedIdAtom = atom<string | null>('r2');

function RouteComponent() {
  return (
    <div className="pl-3 pt-12 max-w-[24rem] border-r border-border-subtle h-full pr-1.5 x-theme-sidebar bg-surface">
      <Tree
        treeId="testing"
        root={root}
        getItemKey={getItemKey}
        renderRow={renderRow}
        selectedIdAtom={selectedIdAtom}
        onSelect={selectItem}
      />
    </div>
  );
}

function selectItem(item: Dummy) {
  return jotaiStore.set(selectedIdAtom, item.id);
}

function getItemKey(item: Dummy) {
  return item.id;
}

function renderRow(item: Dummy) {
  return (
    <div className="flex items-center gap-2 h-full">
      {item.model === 'request' && <code className="font-mono text-editor text-primary">GET</code>}{' '}
      {item.name}
    </div>
  );
}
