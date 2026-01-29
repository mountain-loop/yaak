import { useCachedNode } from '@dnd-kit/core/dist/hooks/utilities';
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
import { useCallback, useMemo, useState } from 'react';
import { modelToYaml } from '../../lib/diffYaml';
import { isSubEnvironment } from '../../lib/model_util';
import { resolvedModelName } from '../../lib/resolvedModelName';
import { showErrorToast } from '../../lib/toast';
import { Banner } from '../core/Banner';
import { Button } from '../core/Button';
import type { CheckboxProps } from '../core/Checkbox';
import { Checkbox } from '../core/Checkbox';
import { DiffViewer } from '../core/Editor/DiffViewer';
import { Icon } from '../core/Icon';
import { InlineCode } from '../core/InlineCode';
import { Input } from '../core/Input';
import { Separator } from '../core/Separator';
import { SplitLayout } from '../core/SplitLayout';
import { HStack } from '../core/Stacks';
import { EmptyStateText } from '../EmptyStateText';
import { gitCallbacks } from './callbacks';
import { handlePushResult } from './git-util';

interface Props {
  syncDir: string;
  onDone: () => void;
  workspace: Workspace;
}

interface CommitTreeNode {
  model: HttpRequest | GrpcRequest | WebsocketRequest | Folder | Environment | Workspace;
  status: GitStatusEntry;
  children: CommitTreeNode[];
  ancestors: CommitTreeNode[];
}

export function GitCommitDialog({ syncDir, onDone, workspace }: Props) {
  const [{ status }, { commit, commitAndPush, add, unstage }] = useGit(
    syncDir,
    gitCallbacks(syncDir),
  );
  const [isPushing, setIsPushing] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [message, setMessage] = useState<string>('');
  const [selectedEntry, setSelectedEntry] = useState<GitStatusEntry | null>(null);

  const handleCreateCommit = async () => {
    setCommitError(null);
    try {
      await commit.mutateAsync({ message });
      onDone();
    } catch (err) {
      setCommitError(String(err));
    }
  };

  const handleCreateCommitAndPush = async () => {
    setIsPushing(true);
    try {
      const r = await commitAndPush.mutateAsync({ message });
      handlePushResult(r);
      onDone();
    } catch (err) {
      showErrorToast({
        id: 'git-commit-and-push-error',
        title: 'Error committing and pushing',
        message: String(err),
      });
    } finally {
      setIsPushing(false);
    }
  };

  const { internalEntries, externalEntries, allEntries } = useMemo(() => {
    const allEntries = [];
    const yaakEntries = [];
    const externalEntries = [];

    for (const entry of status.data?.entries ?? []) {
      allEntries.push(entry);
      if (entry.next == null && entry.prev == null) {
        externalEntries.push(entry);
      } else {
        yaakEntries.push(entry);
      }
    }
    return { internalEntries: yaakEntries, externalEntries, allEntries };
  }, [status.data?.entries]);

  const hasAddedAnything = allEntries.find((e) => e.staged) != null;
  const hasAnythingToAdd = allEntries.find((e) => e.status !== 'current') != null;

  const tree: CommitTreeNode | null = useMemo(() => {
    const next = (
      model: CommitTreeNode['model'],
      ancestors: CommitTreeNode[],
    ): CommitTreeNode | null => {
      const statusEntry = internalEntries?.find((s) => s.relaPath.includes(model.id));
      if (statusEntry == null) {
        return null;
      }

      const node: CommitTreeNode = {
        model,
        status: statusEntry,
        children: [],
        ancestors,
      };

      for (const entry of internalEntries) {
        const childModel = entry.next ?? entry.prev;

        // Should never happen because we're iterating internalEntries
        if (childModel == null) continue;

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
  }, [workspace, internalEntries]);

  const checkNode = useCallback(
    (treeNode: CommitTreeNode) => {
      const checked = nodeCheckedStatus(treeNode);
      const newChecked = checked === 'indeterminate' ? true : !checked;
      setCheckedAndChildren(treeNode, newChecked, unstage.mutate, add.mutate);
      // TODO: Also ensure parents are added properly
    },
    [add.mutate, unstage.mutate],
  );

  const checkEntry = useCallback(
    (entry: GitStatusEntry) => {
      if (entry.staged) unstage.mutate({ relaPaths: [entry.relaPath] });
      else add.mutate({ relaPaths: [entry.relaPath] });
    },
    [add.mutate, unstage.mutate],
  );

  const handleSelectChild = useCallback(
    (entry: GitStatusEntry) => {
      if (entry === selectedEntry) {
        setSelectedEntry(null);
      } else {
        setSelectedEntry(entry);
      }
    },
    [selectedEntry],
  );

  if (tree == null) {
    return null;
  }

  if (!hasAnythingToAdd) {
    return <EmptyStateText>No changes since last commit</EmptyStateText>;
  }

  return (
    <div className="h-full px-2 pb-4">
      <SplitLayout
        name="commit-horizontal"
        layout="horizontal"
        defaultRatio={0.6}
        firstSlot={({ style }) => (
          <div style={style} className="h-full px-4">
            <SplitLayout
              name="commit-vertical"
              layout="vertical"
              defaultRatio={0.35}
              firstSlot={({ style: innerStyle }) => (
                <div
                  style={innerStyle}
                  className="h-full overflow-y-auto pb-3 pr-0.5 transform-cpu"
                >
                  <TreeNodeChildren
                    node={tree}
                    depth={0}
                    onCheck={checkNode}
                    onSelect={handleSelectChild}
                    selectedPath={selectedEntry?.relaPath ?? null}
                  />
                  {externalEntries.find((e) => e.status !== 'current') && (
                    <>
                      <Separator className="mt-3 mb-1">External file changes</Separator>
                      {externalEntries.map((entry) => (
                        <ExternalTreeNode
                          key={entry.relaPath + entry.status}
                          entry={entry}
                          onCheck={checkEntry}
                        />
                      ))}
                    </>
                  )}
                </div>
              )}
              secondSlot={({ style: innerStyle }) => (
                <div style={innerStyle} className="grid grid-rows-[minmax(0,1fr)_auto] gap-3 pb-2">
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
                  {commitError && <Banner color="danger">{commitError}</Banner>}
                  <HStack alignItems="center">
                    <InlineCode>{status.data?.headRefShorthand}</InlineCode>
                    <HStack space={2} className="ml-auto">
                      <Button
                        color="secondary"
                        size="sm"
                        onClick={handleCreateCommit}
                        disabled={!hasAddedAnything}
                        isLoading={isPushing}
                      >
                        Commit
                      </Button>
                      <Button
                        color="primary"
                        size="sm"
                        disabled={!hasAddedAnything}
                        onClick={handleCreateCommitAndPush}
                        isLoading={isPushing}
                      >
                        Commit and Push
                      </Button>
                    </HStack>
                  </HStack>
                </div>
              )}
            />
          </div>
        )}
        secondSlot={({ style }) => (
          <div style={style} className="h-full px-4 border-l border-l-border-subtle">
            {selectedEntry ? (
              <DiffPanel entry={selectedEntry} />
            ) : (
              <EmptyStateText>Select a change to view diff</EmptyStateText>
            )}
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
  onSelect,
  selectedPath,
}: {
  node: CommitTreeNode | null;
  depth: number;
  onCheck: (node: CommitTreeNode, checked: boolean) => void;
  onSelect: (entry: GitStatusEntry) => void;
  selectedPath: string | null;
}) {
  if (node === null) return null;
  if (!isNodeRelevant(node)) return null;

  const checked = nodeCheckedStatus(node);
  const isSelected = selectedPath === node.status.relaPath;

  return (
    <div
      className={classNames(
        depth > 0 && 'pl-4 ml-2 border-l border-dashed border-border-subtle relative',
      )}
    >
      <div
        className={classNames(
          'relative flex gap-1 w-full h-xs items-center',
          isSelected ? 'text-text' : 'text-text-subtle',
        )}
      >
        {isSelected && (
          <div className="absolute -left-[100vw] right-0 top-0 bottom-0 bg-surface-active opacity-30 -z-10" />
        )}
        <Checkbox
          checked={checked}
          title={checked ? 'Unstage change' : 'Stage change'}
          hideLabel
          onChange={(checked) => onCheck(node, checked)}
        />
        <button
          type="button"
          className={classNames('flex-1 min-w-0 flex items-center gap-1 px-1 py-0.5 text-left')}
          onClick={() => node.status.status !== 'current' && onSelect(node.status)}
        >
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
            <span aria-hidden className="w-4" />
          )}
          <div className="truncate flex-1">{resolvedModelName(node.model)}</div>
          {node.status.status !== 'current' && (
            <InlineCode
              className={classNames(
                'py-0 bg-transparent w-[6rem] text-center shrink-0',
                node.status.status === 'modified' && 'text-info',
                node.status.status === 'untracked' && 'text-success',
                node.status.status === 'removed' && 'text-danger',
              )}
            >
              {node.status.status}
            </InlineCode>
          )}
        </button>
      </div>

      {node.children.map((childNode) => {
        return (
          <TreeNodeChildren
            key={childNode.status.relaPath + childNode.status.status + childNode.status.staged}
            node={childNode}
            depth={depth + 1}
            onCheck={onCheck}
            onSelect={onSelect}
            selectedPath={selectedPath}
          />
        );
      })}
    </div>
  );
}

function ExternalTreeNode({
  entry,
  onCheck,
}: {
  entry: GitStatusEntry;
  onCheck: (entry: GitStatusEntry) => void;
}) {
  if (entry.status === 'current') {
    return null;
  }

  return (
    <Checkbox
      fullWidth
      className="h-xs w-full hover:bg-surface-highlight rounded px-1 group"
      checked={entry.staged}
      onChange={() => onCheck(entry)}
      title={
        <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] gap-1 w-full items-center">
          <Icon color="secondary" icon="file_code" />
          <div className="truncate">{entry.relaPath}</div>
          <InlineCode
            className={classNames(
              'py-0 ml-auto bg-transparent w-[6rem] text-center',
              entry.status === 'modified' && 'text-info',
              entry.status === 'untracked' && 'text-success',
              entry.status === 'removed' && 'text-danger',
            )}
          >
            {entry.status}
          </InlineCode>
        </div>
      }
    />
  );
}

function nodeCheckedStatus(root: CommitTreeNode): CheckboxProps['checked'] {
  let numVisited = 0;
  let numChecked = 0;
  let numCurrent = 0;

  const visitChildren = (n: CommitTreeNode) => {
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
  }
  if (numChecked === 0) {
    return false;
  }
  return 'indeterminate';
}

function setCheckedAndChildren(
  node: CommitTreeNode,
  checked: boolean,
  unstage: (args: { relaPaths: string[] }) => void,
  add: (args: { relaPaths: string[] }) => void,
) {
  const toAdd: string[] = [];
  const toUnstage: string[] = [];

  const next = (node: CommitTreeNode) => {
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

function isNodeRelevant(node: CommitTreeNode): boolean {
  if (node.status.status !== 'current') {
    return true;
  }

  // Recursively check children
  return node.children.some((c) => isNodeRelevant(c));
}

function DiffPanel({ entry }: { entry: GitStatusEntry }) {
  const prevYaml = modelToYaml(entry.prev);
  const nextYaml = modelToYaml(entry.next);

  return (
    <div className="h-full flex flex-col">
      <div className="text-sm text-text-subtle mb-2 px-1">
        {resolvedModelName(entry.next ?? entry.prev)} ({entry.status})
      </div>
      <DiffViewer original={prevYaml ?? ''} modified={nextYaml ?? ''} className="flex-1 min-h-0" />
    </div>
  );
}
