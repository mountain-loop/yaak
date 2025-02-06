import { useGit } from '@yaakapp-internal/git';
import { useActiveWorkspace } from '../hooks/useActiveWorkspace';
import { useWorkspaceMeta } from '../hooks/useWorkspaceMeta';
import { sync } from '../init/sync';
import { showConfirm, showConfirmDelete } from '../lib/confirm';
import { showDialog } from '../lib/dialog';
import { showPrompt } from '../lib/prompt';
import { showErrorToast, showToast } from '../lib/toast';
import type { DropdownItem } from './core/Dropdown';
import { Dropdown } from './core/Dropdown';
import { Icon } from './core/Icon';
import { InlineCode } from './core/InlineCode';
import { BranchSelectionDialog } from './git/BranchSelectionDialog';
import { HistoryDialog } from './git/HistoryDialog';
import { GitCommitDialog } from './GitCommitDialog';

export function GitDropdown() {
  const workspaceMeta = useWorkspaceMeta();

  if (workspaceMeta?.settingSyncDir == null) {
    return null;
  }

  return <SyncDropdownWithSyncDir syncDir={workspaceMeta.settingSyncDir} />;
}

function SyncDropdownWithSyncDir({ syncDir }: { syncDir: string }) {
  const workspace = useActiveWorkspace();
  const [{ status, log }, { branch, deleteBranch, mergeBranch, init, push, pull, checkout }] =
    useGit(syncDir);

  if (workspace == null) return null;

  const tryCheckout = (branch: string, force: boolean) => {
    checkout.mutate(
      { branch, force },
      {
        async onError(err) {
          if (!force) {
            // Checkout failed so ask user if they want to force it
            const forceCheckout = await showConfirm({
              id: 'git-force-checkout',
              title: 'Conflicts Detected',
              description:
                'Your branch has conflicts. Either make a commit or force checkout to discard changes.',
              confirmText: 'Force Checkout',
              color: 'warning',
            });
            if (forceCheckout) {
              tryCheckout(branch, true);
            }
          } else {
            // Checkout failed
            showErrorToast('git-checkout-error', String(err));
          }
        },
        async onSuccess() {
          showToast({
            id: 'git-checkout-success',
            message: (
              <>
                Switched branch <InlineCode>{branch}</InlineCode>
              </>
            ),
            color: 'success',
          });
          await sync({ force: true });
        },
      },
    );
  };

  const noRepo = status.error?.includes('not found');
  const items: DropdownItem[] = noRepo
    ? [
        {
          label: 'Initialize',
          leftSlot: <Icon icon="git_branch" />,
          onSelect: init.mutate,
        },
      ]
    : [
        {
          label: 'View History',
          hidden: (log.data ?? []).length === 0,
          leftSlot: <Icon icon="history" />,
          onSelect: async () => {
            showDialog({
              id: 'git-history',
              size: 'md',
              title: 'Commit History',
              render: () => <HistoryDialog log={log.data ?? []} />,
            });
          },
        },
        {
          label: 'New Branch',
          leftSlot: <Icon icon="git_branch_plus" />,
          async onSelect() {
            const name = await showPrompt({
              id: 'git-branch-name',
              title: 'Create Branch',
              label: 'Branch Name',
            });
            if (name) {
              await branch.mutateAsync(
                { branch: name },
                {
                  onError: (err) => {
                    showErrorToast('git-branch-error', String(err));
                  },
                },
              );
              tryCheckout(name, false);
            }
          },
        },
        {
          label: 'Merge Branch',
          leftSlot: <Icon icon="merge" />,
          hidden: (status.data?.branches ?? []).length <= 1,
          async onSelect() {
            showDialog({
              id: 'git-merge',
              title: 'Merge Branch',
              size: 'sm',
              description: (
                <>
                  Select a branch to merge into{' '}
                  <InlineCode>{status.data?.headRefShorthand}</InlineCode>
                </>
              ),
              render: ({ hide }) => (
                <BranchSelectionDialog
                  selectText="Merge"
                  branches={(status.data?.branches ?? []).filter(
                    (b) => b !== status.data?.headRefShorthand,
                  )}
                  onCancel={hide}
                  onSelect={async (branch) => {
                    await mergeBranch.mutateAsync(
                      { branch, force: false },
                      {
                        onSettled: hide,
                        onSuccess() {
                          showToast({
                            id: 'git-merged-branch',
                            message: (
                              <>
                                Merged <InlineCode>{branch}</InlineCode> into{' '}
                                <InlineCode>{status.data?.headRefShorthand}</InlineCode>
                              </>
                            ),
                          });
                          sync({ force: true });
                        },
                        onError(err) {
                          showErrorToast('git-merged-branch-error', String(err));
                        },
                      },
                    );
                  }}
                />
              ),
            });
          },
        },
        {
          label: 'Delete Branch',
          leftSlot: <Icon icon="trash" />,
          hidden: (status.data?.branches ?? []).length <= 1,
          color: 'danger',
          async onSelect() {
            const currentBranch = status.data?.headRefShorthand;
            if (currentBranch == null) return;

            const confirmed = await showConfirmDelete({
              id: 'git-delete-branch',
              title: 'Delete Branch',
              description: (
                <>
                  Permanently delete <InlineCode>{currentBranch}</InlineCode>?
                </>
              ),
            });
            if (confirmed) {
              await deleteBranch.mutateAsync(
                { branch: currentBranch },
                {
                  onError(err) {
                    showErrorToast('git-delete-branch-error', String(err));
                  },
                  async onSuccess() {
                    await sync({ force: true });
                  },
                },
              );
            }
          },
        },
        { type: 'separator' },
        {
          label: 'Push',
          hidden: (status.data?.origins ?? []).length === 0,
          leftSlot: <Icon icon="arrow_up_from_line" />,
          waitForOnSelect: true,
          async onSelect() {
            const message = await push.mutateAsync();
            if (message === 'nothing_to_push') {
              showToast({ id: 'push-success', message: 'Nothing to push', color: 'info' });
            } else {
              showToast({ id: 'push-success', message: 'Push successful', color: 'success' });
            }
          },
        },
        {
          label: 'Pull',
          hidden: (status.data?.origins ?? []).length === 0,
          leftSlot: <Icon icon="arrow_down_to_line" />,
          waitForOnSelect: true,
          async onSelect() {
            const result = await pull.mutateAsync(undefined, {
              onError(err) {
                showErrorToast('git-pull-error', String(err));
              },
            });
            if (result.receivedObjects > 0) {
              showToast({
                id: 'git-pull-success',
                message: `Pulled ${result.receivedObjects} objects`,
                color: 'success',
              });
              await sync({ force: true });
            } else {
              showToast({ id: 'git-pull-success', message: 'Already up to date', color: 'info' });
            }
          },
        },
        {
          label: 'Commit',
          leftSlot: <Icon icon="git_branch" />,
          onSelect() {
            showDialog({
              id: 'commit',
              title: 'Commit Changes',
              size: 'full',
              className: '!max-h-[min(80vh,40rem)] !max-w-[min(50rem,90vw)]',
              render: ({ hide }) => (
                <GitCommitDialog syncDir={syncDir} onDone={hide} workspace={workspace} />
              ),
            });
          },
        },
        { type: 'separator', label: 'Branches' },
        ...(status.data?.branches ?? []).map((branch) => {
          const isCurrent = status.data?.headRefShorthand === branch;
          return {
            label: branch,
            leftSlot: <Icon icon={isCurrent ? 'check' : 'empty'} />,
            onSelect: isCurrent ? undefined : () => tryCheckout(branch, false),
          };
        }),
      ];

  return (
    <Dropdown fullWidth items={items}>
      <button className="px-3 h-md border-t border-border flex items-center justify-between text-text-subtle">
        {noRepo ? 'Configure Git' : <InlineCode>{status.data?.headRefShorthand}</InlineCode>}
        <Icon icon="git_branch" size="sm" />
      </button>
    </Dropdown>
  );
}
