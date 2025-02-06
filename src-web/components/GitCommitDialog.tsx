import type { GitStatusEntry } from '@yaakapp-internal/git';
import { useGit } from '@yaakapp-internal/git';
import type {
  Environment,
  Folder,
  GrpcRequest,
  HttpRequest,
  WebsocketRequest,
  Workspace,
} from '@yaakapp-internal/models';
import classNames from 'classnames';

import { useMemo, useState } from 'react';
import { fallbackRequestName } from '../lib/fallbackRequestName';
import { Banner } from './core/Banner';
import { Button } from './core/Button';
import type { CheckboxProps } from './core/Checkbox';
import { Checkbox } from './core/Checkbox';
import { Icon } from './core/Icon';
import { InlineCode } from './core/InlineCode';
import { Input } from './core/Input';
import { SplitLayout } from './core/SplitLayout';
import { HStack } from './core/Stacks';
import { EmptyStateText } from './EmptyStateText';

interface Props {
  syncDir: string;
  onDone: () => void;
  workspace: Workspace;
}

interface TreeNode {
  model: HttpRequest | GrpcRequest | WebsocketRequest | Folder | Environment | Workspace;
  status: GitStatusEntry;
  children: TreeNode[];
  ancestors: TreeNode[];
}

export function GitCommitDialog({ syncDir, onDone, workspace }: Props) {
  const [{ status }, { commit, add, unstage, push }] = useGit(syncDir);
  const [message, setMessage] = useState<string>('');

  const handleCreateCommit = async () => {
    await commit.mutateAsync({ message });
    onDone();
  };

  const handleCreateCommitAndPush = async () => {
    await handleCreateCommit();
    await push.mutateAsync();
    onDone();
  };

  const entries = status.data?.entries ?? null;

  const hasAddedAnything = entries?.find((s) => s.staged) != null;
  const hasAnythingToAdd = entries?.find((s) => s.status !== 'current') != null;

  const tree: TreeNode | null = useMemo(() => {
    if (entries == null) {
      return null;
    }

    const next = (model: TreeNode['model'], ancestors: TreeNode[]): TreeNode | null => {
      const statusEntry = entries?.find((s) => s.relaPath.includes(model.id));
      if (statusEntry == null) {
        return null;
      }

      const node: TreeNode = {
        model,
        status: statusEntry,
        children: [],
        ancestors,
      };

      for (const entry of entries) {
        const childModel = entry.next ?? entry.prev;
        if (childModel == null) return null; // TODO: Is this right?

        // TODO: Figure out why not all of these show up
        if ('folderId' in childModel && childModel.folderId != null) {
          if (childModel.folderId === model.id) {
            const c = next(childModel, [...ancestors, node]);
            if (c != null) node.children.push(c);
          }
        } else if ('workspaceId' in childModel && childModel.workspaceId === model.id) {
          const c = next(childModel, [...ancestors, node]);
          if (c != null) node.children.push(c);
        } else {
          // Do nothing
        }
      }

      return node;
    };
    return next(workspace, []);
  }, [entries, workspace]);

  if (tree == null) {
    return null;
  }

  if (!hasAnythingToAdd) {
    return <EmptyStateText>No changes since last commit</EmptyStateText>;
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
            <Input
              className="!text-base font-sans rounded-md"
              placeholder="Commit message..."
              onChange={setMessage}
              stateKey={null}
              label="Commit message"
              fullHeight
              multiLine
              hideLabel
            />
            {commit.error && <Banner color="danger">{commit.error}</Banner>}
            <HStack alignItems="center">
              <InlineCode>{status.data?.headRefShorthand}</InlineCode>
              <HStack space={2} className="ml-auto">
                <Button
                  color="secondary"
                  size="sm"
                  onClick={handleCreateCommit}
                  disabled={!hasAddedAnything}
                  isLoading={push.isPending || commit.isPending}
                >
                  Commit
                </Button>
                <Button
                  color="primary"
                  size="sm"
                  disabled={!hasAddedAnything}
                  onClick={handleCreateCommitAndPush}
                  isLoading={push.isPending || commit.isPending}
                >
                  Commit and Push
                </Button>
              </HStack>
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
          fullWidth
          className="w-full hover:bg-surface-highlight rounded px-1 group"
          checked={checked}
          onChange={(checked) => onCheck(node, checked)}
          title={
            <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] gap-1 w-full items-center">
              {node.model.model !== 'http_request' &&
              node.model.model !== 'grpc_request' &&
              node.model.model !== 'websocket_request' ? (
                <Icon
                  color="secondary"
                  icon={
                    node.model.model === 'folder'
                      ? 'folder'
                      : node.model.model === 'environment'
                        ? 'variable'
                        : 'house'
                  }
                />
              ) : (
                <span aria-hidden />
              )}
              <div className="truncate">
                {fallbackRequestName(node.model)}
                {/*({node.model.model})*/}
                {/*({node.status.staged ? 'Y' : 'N'})*/}
              </div>
              {node.status.status !== 'current' && (
                <InlineCode
                  className={classNames(
                    'py-0 ml-auto bg-transparent w-[6rem] text-center',
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
  let numVisited = 0;
  let numChecked = 0;
  let numCurrent = 0;

  const visitChildren = (n: TreeNode) => {
    numVisited += 1;
    if (n.status.status === 'current') {
      numCurrent += 1;
    } else if (n.status.staged) {
      numChecked += 1;
    }
    for (const child of n.children) {
      visitChildren(child);
    }
  };

  visitChildren(root);

  if (numVisited === numChecked + numCurrent) {
    return true;
  } else if (numChecked === 0) {
    return false;
  } else {
    return 'indeterminate';
  }
}

function setCheckedAndChildren(
  node: TreeNode,
  checked: boolean,
  unstage: (args: { relaPaths: string[] }) => void,
  add: (args: { relaPaths: string[] }) => void,
) {
  const toAdd: string[] = [];
  const toUnstage: string[] = [];

  const next = (node: TreeNode) => {
    for (const child of node.children) {
      next(child);
    }

    if (node.status.status === 'current') {
      // Nothing required
    } else if (checked && !node.status.staged) {
      toAdd.push(node.status.relaPath);
    } else if (!checked && node.status.staged) {
      toUnstage.push(node.status.relaPath);
    }
  };

  next(node);

  if (toAdd.length > 0) add({ relaPaths: toAdd });
  if (toUnstage.length > 0) unstage({ relaPaths: toUnstage });
}

function isNodeRelevant(node: TreeNode): boolean {
  if (node.status.status !== 'current') {
    return true;
  }

  // Recursively check children
  return node.children.some((c) => isNodeRelevant(c));
}
