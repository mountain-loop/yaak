import { useGit } from '@yaakapp-internal/git';
import type { GitStatusEntry } from '@yaakapp-internal/git/bindings/git';
import type {
  Environment,
  Folder,
  GrpcRequest,
  HttpRequest,
  Workspace,
} from '@yaakapp-internal/models';
import classNames from 'classnames';

import { useMemo, useState } from 'react';
import YAML from 'yaml';
import { fallbackRequestName } from '../lib/fallbackRequestName';
import { Banner } from './core/Banner';
import { Button } from './core/Button';
import type { CheckboxProps } from './core/Checkbox';
import { Checkbox } from './core/Checkbox';
import { InlineCode } from './core/InlineCode';
import { SplitLayout } from './core/SplitLayout';
import { HStack } from './core/Stacks';
import { EmptyStateText } from './EmptyStateText';
import { Editor } from './core/Editor/Editor';

interface Props {
  syncDir: string;
  onDone: () => void;
  workspace: Workspace;
}

interface TreeNode {
  model: HttpRequest | GrpcRequest | Folder | Environment | Workspace;
  status: GitStatusEntry;
  children: TreeNode[];
  ancestors: TreeNode[];
}

export function GitCommitDialog({ syncDir, onDone, workspace }: Props) {
  const [{ status }, { commit, add, unstage }] = useGit(syncDir);
  const [message, setMessage] = useState<string>('');

  const handleCreateCommit = async () => {
    await commit.mutateAsync({ message });
    onDone();
  };

  const hasAddedAnything = status.data?.find((s) => s.staged) != null;

  const tree: TreeNode | null = useMemo(() => {
    if (status.data == null) {
      return null;
    }

    const next = (model: TreeNode['model'], ancestors: TreeNode[]): TreeNode | null => {
      const statusEntry = status.data?.find((s) => s.relaPath.includes(model.id));
      if (statusEntry == null) {
        return null;
      }

      const node: TreeNode = {
        model,
        status: statusEntry,
        children: [],
        ancestors,
      };

      node.children = status.data
        .map((s) => {
          const data = s.next ?? s.prev;
          if (data == null) return null; // TODO: Is this right?

          const childModel: TreeNode['model'] = YAML.parse(data);
          // TODO: Figure out why not all of these show up
          if ('folderId' in childModel && childModel.folderId != null) {
            if (childModel.folderId === model.id) {
              return next(childModel, [...ancestors, node]);
            }
          } else if ('workspaceId' in childModel && childModel.workspaceId === model.id) {
            return next(childModel, [...ancestors, node]);
          } else {
            return null;
          }
        })
        .filter((c) => c != null);
      return node;
    };
    return next(workspace, []);
  }, [status.data, workspace]);

  if (tree == null) {
    return null;
  }

  if (status.data != null && status.data.length === 0) {
    return (
      <EmptyStateText>
        No changes to commit.
        <br />
        Please check back once you have made changes.
      </EmptyStateText>
    );
  }

  const checkNode = (treeNode: TreeNode) => {
    const checked = nodeCheckedStatus(treeNode);
    const newChecked = checked === 'indeterminate' ? true : !checked;
    setCheckedAndChildren(treeNode, newChecked, unstage.mutate, add.mutate);
    // TODO: Also ensure parents are added properly
  };

  return (
    <div className="grid grid-rows-1 h-full">
      <SplitLayout
        name="commit"
        layout="vertical"
        defaultRatio={0.3}
        firstSlot={({ style }) => (
          <div style={style} className="h-full overflow-y-auto -ml-1 pb-3">
            <TreeNodeChildren node={tree} depth={0} onCheck={checkNode} />
          </div>
        )}
        secondSlot={({ style }) => (
          <div style={style} className="grid grid-rows-[minmax(0,1fr)_auto] gap-3 pb-2">
            <div className="bg-surface-highlight border border-border rounded-md overflow-hidden">
              <Editor
                className="!text-base font-sans h-full rounded-md"
                placeholder="Commit message..."
                onChange={setMessage}
                stateKey={null}
              />
            </div>
            {commit.error && <Banner color="danger">{commit.error}</Banner>}
            <HStack justifyContent="end" space={2}>
              <Button
                color="secondary"
                size="sm"
                onClick={handleCreateCommit}
                disabled={!hasAddedAnything}
              >
                Commit
              </Button>
              {/*<Button color="secondary" size="sm" disabled={!hasAddedAnything}>*/}
              {/*  Commit and Push*/}
              {/*</Button>*/}
            </HStack>
          </div>
        )}
      />
    </div>
  );
}

function TreeNodeChildren({
  node,
  depth,
  onCheck,
}: {
  node: TreeNode | null;
  depth: number;
  onCheck: (node: TreeNode, checked: boolean) => void;
}) {
  if (node === null) return null;
  if (!isNodeRelevant(node)) return null;

  const checked = nodeCheckedStatus(node);
  return (
    <div
      className={classNames(
        depth > 0 && 'pl-1 ml-[10px] border-l border-dashed border-border-subtle',
      )}
    >
      <div className="flex gap-3 w-full h-xs">
        <Checkbox
          className="w-full hover:bg-surface-highlight rounded px-1 group"
          checked={checked}
          onChange={(checked) => onCheck(node, checked)}
          title={
            <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-1 w-full">
              <div className="truncate">
                {fallbackRequestName(node.model)}
                {/*({node.model.model})*/}
                {/*({node.status.staged ? 'Y' : 'N'})*/}
              </div>
              {node.status.status !== 'current' && (
                <InlineCode
                  className={classNames(
                    'py-0 ml-auto !bg-surface w-[6rem] text-center',
                    node.status.status === 'modified' && 'text-info',
                    node.status.status === 'added' && 'text-success',
                    node.status.status === 'removed' && 'text-danger',
                  )}
                >
                  {node.status.status}
                </InlineCode>
              )}
            </div>
          }
        />
      </div>

      {node.children.map((childNode, i) => {
        return (
          <TreeNodeChildren
            key={childNode.status.relaPath + i}
            node={childNode}
            depth={depth + 1}
            onCheck={onCheck}
          />
        );
      })}
    </div>
  );
}

function nodeCheckedStatus(root: TreeNode): CheckboxProps['checked'] {
  let leavesVisited = 0;
  let leavesChecked = 0;
  let leavesCurrent = 0;

  const visitChildren = (n: TreeNode) => {
    if (n.children.length === 0) {
      leavesVisited += 1;
      if (n.status.status === 'current') {
        leavesCurrent += 1;
      } else if (n.status.staged) {
        leavesChecked += 1;
      }
    }
    for (const child of n.children) {
      visitChildren(child);
    }
  };

  visitChildren(root);

  if (leavesVisited === leavesChecked + leavesCurrent) {
    return true;
  } else if (leavesChecked === 0) {
    return false;
  } else {
    return 'indeterminate';
  }
}

function setCheckedAndChildren(
  node: TreeNode,
  checked: boolean,
  unstage: (args: { relaPath: string }) => void,
  add: (args: { relaPath: string }) => void,
) {
  for (const child of node.children) {
    setCheckedAndChildren(child, checked, unstage, add);
  }
  setChecked(node, checked, unstage, add);
}

function setChecked(
  node: TreeNode,
  checked: boolean,
  unstage: (args: { relaPath: string }) => void,
  add: (args: { relaPath: string }) => void,
) {
  if (node.status.status === 'current') {
    // Nothing required
  } else if (checked) {
    add({ relaPath: node.status.relaPath });
  } else {
    unstage({ relaPath: node.status.relaPath });
  }
}

function isNodeRelevant(node: TreeNode): boolean {
  if (node.status.status !== 'current') {
    return true;
  }

  // Recursively check children
  return node.children.some((c) => isNodeRelevant(c));
}
