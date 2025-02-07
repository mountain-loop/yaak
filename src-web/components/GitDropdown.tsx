import { gitInit, useGit } from '@yaakapp-internal/git';
import type { WorkspaceMeta } from '@yaakapp-internal/models';
import classNames from 'classnames';
import type { HTMLAttributes } from 'react';
import { forwardRef } from 'react';
import { openWorkspaceSettings } from '../commands/openWorkspaceSettings';
import { useActiveWorkspace } from '../hooks/useActiveWorkspace';
import { useKeyValue } from '../hooks/useKeyValue';
import { useWorkspaceMeta } from '../hooks/useWorkspaceMeta';
import { sync } from '../init/sync';
import { showConfirm, showConfirmDelete } from '../lib/confirm';
import { showDialog } from '../lib/dialog';
import { showPrompt } from '../lib/prompt';
import { showErrorToast, showToast } from '../lib/toast';
import { Banner } from './core/Banner';
import type { DropdownItem } from './core/Dropdown';
import { Dropdown } from './core/Dropdown';
import { Icon } from './core/Icon';
import { InlineCode } from './core/InlineCode';
import { BranchSelectionDialog } from './git/BranchSelectionDialog';
import { HistoryDialog } from './git/HistoryDialog';
import { GitCommitDialog } from './GitCommitDialog';

export function GitDropdown() {
  const workspaceMeta = useWorkspaceMeta();
  if (workspaceMeta == null) return null;

  if (workspaceMeta.settingSyncDir == null) {
    return <SetupSyncDropdown workspaceMeta={workspaceMeta} />;
  }

  return <SyncDropdownWithSyncDir syncDir={workspaceMeta.settingSyncDir} />;
}

function SyncDropdownWithSyncDir({ syncDir }: { syncDir: string }) {
  const workspace = useActiveWorkspace();
  const [{ status, log }, { branch, deleteBranch, mergeBranch, push, pull, checkout }] =
    useGit(syncDir);

  if (workspace == null) {
    return null;
  }

  const noRepo = status.error?.includes('not found');
  if (noRepo) {
    return <SetupGitDropdown workspaceId={workspace.id} initRepo={() => gitInit(syncDir)} />;
  }

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

  const items: DropdownItem[] = [
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
              Select a branch to merge into <InlineCode>{status.data?.headRefShorthand}</InlineCode>
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
    { type: 'separator', label: 'Branches', hidden: (status.data?.branches ?? []).length < 1 },
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
      <GitMenuButton>
        {noRepo ? 'Configure Git' : <InlineCode>{status.data?.headRefShorthand}</InlineCode>}
        <Icon icon="git_branch" size="sm" />
      </GitMenuButton>
    </Dropdown>
  );
}

const GitMenuButton = forwardRef<HTMLButtonElement, HTMLAttributes<HTMLButtonElement>>(
  function GitMenuButton({ className, ...props }: HTMLAttributes<HTMLButtonElement>, ref) {
    return (
      <button
        ref={ref}
        className={classNames(
          className,
          'px-3 h-md border-t border-border flex items-center justify-between text-text-subtle',
        )}
        {...props}
      />
    );
  },
);

function SetupSyncDropdown({ workspaceMeta }: { workspaceMeta: WorkspaceMeta }) {
  const { value: hidden, set: setHidden } = useKeyValue<Record<string, boolean>>({
    key: 'setup_sync',
    fallback: {},
  });

  if (hidden == null || hidden[workspaceMeta.workspaceId]) {
    return null;
  }

  const banner = (
    <Banner color="info">
      When enabled, workspace data syncs to the chosen folder as text files, ideal for backup and
      Git collaboration.
    </Banner>
  );

  return (
    <Dropdown
      fullWidth
      items={[
        {
          type: 'content',
          label: banner,
        },
        {
          label: 'Open Workspace Settings',
          leftSlot: <Icon icon="settings" />,
          onSelect() {
            openWorkspaceSettings.mutate({ openSyncMenu: true });
          },
        },
        {
          label: 'Hide This Message',
          leftSlot: <Icon icon="eye_closed" />,
          async onSelect() {
            const confirmed = await showConfirm({
              id: 'hide-sync-menu-prompt',
              title: 'Hide Setup Message',
              description: 'You can configure filesystem sync or Git it in the workspace settings',
            });
            if (confirmed) {
              await setHidden((prev) => ({ ...prev, [workspaceMeta.workspaceId]: true }));
            }
          },
        },
      ]}
    >
      <GitMenuButton>
        <div className="text-sm text-text-subtle grid grid-cols-[auto_minmax(0,1fr)] items-center gap-2">
          <Icon icon="wrench" />
          <div className="truncate">Setup FS Sync or Git</div>
        </div>
      </GitMenuButton>
    </Dropdown>
  );
}

function SetupGitDropdown({
  workspaceId,
  initRepo,
}: {
  workspaceId: string;
  initRepo: () => void;
}) {
  const { value: hidden, set: setHidden } = useKeyValue<Record<string, boolean>>({
    key: 'setup_git_repo',
    fallback: {},
  });

  if (hidden == null || hidden[workspaceId]) {
    return null;
  }

  const banner = <Banner color="info">Initialize local repo to start versioning with Git</Banner>;

  return (
    <Dropdown
      fullWidth
      items={[
        { type: 'content', label: banner },
        {
          label: 'Initialize Git Repo',
          leftSlot: <Icon icon="magic_wand" />,
          onSelect: initRepo,
        },
        {
          color: 'warning',
          label: 'Hide This Message',
          leftSlot: <Icon icon="eye_closed" />,
          async onSelect() {
            const confirmed = await showConfirm({
              id: 'hide-git-init-prompt',
              title: 'Hide Git Setup',
              description: 'You can initialize a git repo outside of Yaak to bring this back',
            });
            if (confirmed) {
              await setHidden((prev) => ({ ...prev, [workspaceId]: true }));
            }
          },
        },
      ]}
    >
      <GitMenuButton>
        <div className="text-sm text-text-subtle grid grid-cols-[auto_minmax(0,1fr)] items-center gap-2">
          <Icon icon="folder_git" />
          <div className="truncate">Setup Git</div>
        </div>
      </GitMenuButton>
    </Dropdown>
  );
}
