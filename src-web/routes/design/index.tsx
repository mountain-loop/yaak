import { createFileRoute } from '@tanstack/react-router';
import { atom } from 'jotai';
import { InlineCode } from '../../components/core/InlineCode';
import { HStack } from '../../components/core/Stacks';
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
  id: 'root',
  icon: 'folder',
  item: { id: 'root', name: 'Workspace', model: 'workspace' },
  children: [
    {
      id: 'f1',
      item: { id: 'f1', model: 'folder', name: 'Folder 1' },
      icon: 'folder',
      children: [
        {
          id: 'r1',
          item: { id: 'r1', model: 'request', name: 'Request 1' },
        },
        {
          id: 'r2',
          item: { id: 'r2', model: 'request', name: 'Request 2' },
        },
      ],
    },
    {
      id: 'f2',
      icon: 'folder',
      item: { id: 'f2', model: 'folder', name: 'Folder 2' },
      children: [],
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
