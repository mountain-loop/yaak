import { useGit } from "@yaakapp-internal/git";
import type { WorkspaceMeta } from "@yaakapp-internal/models";
import classNames from "classnames";
import { useAtomValue } from "jotai";
import type { HTMLAttributes } from "react";
import { forwardRef } from "react";
import { openWorkspaceSettings } from "../../commands/openWorkspaceSettings";
import { activeWorkspaceAtom, activeWorkspaceMetaAtom } from "../../hooks/useActiveWorkspace";
import { useKeyValue } from "../../hooks/useKeyValue";
import { useRandomKey } from "../../hooks/useRandomKey";
import { sync } from "../../init/sync";
import { showConfirm, showConfirmDelete } from "../../lib/confirm";
import { showDialog } from "../../lib/dialog";
import { fireAndForget } from "../../lib/fireAndForget";
import { showPrompt } from "../../lib/prompt";
import { showErrorToast, showToast } from "../../lib/toast";
import { Banner } from "../core/Banner";
import type { DropdownItem } from "../core/Dropdown";
import { Dropdown } from "../core/Dropdown";
import { Icon } from "../core/Icon";
import { InlineCode } from "../core/InlineCode";
import { gitCallbacks } from "./callbacks";
import { GitCommitDialog } from "./GitCommitDialog";
import { GitRemotesDialog } from "./GitRemotesDialog";
import { handlePullResult, handlePushResult } from "./git-util";
import { HistoryDialog } from "./HistoryDialog";

export function GitDropdown() {
  const workspaceMeta = useAtomValue(activeWorkspaceMetaAtom);
  if (workspaceMeta == null) return null;

  if (workspaceMeta.settingSyncDir == null) {
    return <SetupSyncDropdown workspaceMeta={workspaceMeta} />;
  }

  return <SyncDropdownWithSyncDir syncDir={workspaceMeta.settingSyncDir} />;
}

function SyncDropdownWithSyncDir({ syncDir }: { syncDir: string }) {
  const workspace = useAtomValue(activeWorkspaceAtom);
  const [refreshKey, regenerateKey] = useRandomKey();
  const [
    { status, log },
    {
      createBranch,
      deleteBranch,
      deleteRemoteBranch,
      renameBranch,
      mergeBranch,
      push,
      pull,
      checkout,
      resetChanges,
      init,
    },
  ] = useGit(syncDir, gitCallbacks(syncDir), refreshKey);

  const localBranches = status.data?.localBranches ?? [];
  const remoteBranches = status.data?.remoteBranches ?? [];
  const remoteOnlyBranches = remoteBranches.filter(
    (b) => !localBranches.includes(b.replace(/^origin\//, "")),
  );
  if (workspace == null) {
    return null;
  }

  const noRepo = status.error?.includes("not found");
  if (noRepo) {
    return <SetupGitDropdown workspaceId={workspace.id} initRepo={init.mutate} />;
  }

  // Still loading
  if (status.data == null) {
    return null;
  }

  const currentBranch = status.data.headRefShorthand;
  const hasChanges = status.data.entries.some((e) => e.status !== "current");
  const _hasRemotes = (status.data.origins ?? []).length > 0;
  const { ahead, behind } = status.data;

  const tryCheckout = (branch: string, force: boolean) => {
    checkout.mutate(
      { branch, force },
      {
        disableToastError: true,
        async onError(err) {
          if (!force) {
            // Checkout failed so ask user if they want to force it
            const forceCheckout = await showConfirm({
              id: "git-force-checkout",
              title: "Обнаружены конфликты",
              description:
                "Your branch has conflicts. Either make a commit or force checkout to discard changes.",
              confirmText: "Принудительный checkout",
              color: "warning",
            });
            if (forceCheckout) {
              tryCheckout(branch, true);
            }
          } else {
            // Checkout failed
            showErrorToast({
              id: "git-checkout-error",
              title: "Ошибка переключения ветки",
              message: String(err),
            });
          }
        },
        async onSuccess(branchName) {
          showToast({
            id: "git-checkout-success",
            message: (
              <>
                Switched branch <InlineCode>{branchName}</InlineCode>
              </>
            ),
            color: "success",
          });
          await sync({ force: true });
        },
      },
    );
  };

  const items: DropdownItem[] = [
    {
      label: "История...",
      hidden: (log.data ?? []).length === 0,
      leftSlot: <Icon icon="history" />,
      onSelect: async () => {
        showDialog({
          id: "git-history",
          size: "md",
          title: "История коммитов",
          noPadding: true,
          render: () => <HistoryDialog log={log.data ?? []} />,
        });
      },
    },
    {
      label: "Управление remote...",
      leftSlot: <Icon icon="hard_drive_download" />,
      onSelect: () => GitRemotesDialog.show(syncDir),
    },
    { type: "separator" },
    {
      label: "Новая ветка...",
      leftSlot: <Icon icon="git_branch_plus" />,
      async onSelect() {
        const name = await showPrompt({
          id: "git-branch-name",
          title: "Создать ветку",
          label: "Имя ветки",
        });
        if (!name) return;

        await createBranch.mutateAsync(
          { branch: name },
          {
            disableToastError: true,
            onError: (err) => {
              showErrorToast({
                id: "git-branch-error",
                title: "Ошибка создания ветки",
                message: String(err),
              });
            },
          },
        );
        tryCheckout(name, false);
      },
    },
    { type: "separator" },
    {
      label: "Отправить (Push)",
      leftSlot: <Icon icon="arrow_up_from_line" />,
      waitForOnSelect: true,
      async onSelect() {
        await push.mutateAsync(undefined, {
          disableToastError: true,
          onSuccess: handlePushResult,
          onError(err) {
            showErrorToast({
              id: "git-push-error",
              title: "Ошибка push изменений",
              message: String(err),
            });
          },
        });
      },
    },
    {
      label: "Получить (Pull)",
      leftSlot: <Icon icon="arrow_down_to_line" />,
      waitForOnSelect: true,
      async onSelect() {
        await pull.mutateAsync(undefined, {
          disableToastError: true,
          onSuccess: handlePullResult,
          onError(err) {
            showErrorToast({
              id: "git-pull-error",
              title: "Ошибка pull изменений",
              message: String(err),
            });
          },
        });
      },
    },
    {
      label: "Коммит...",

      leftSlot: <Icon icon="git_commit_vertical" />,
      onSelect() {
        showDialog({
          id: "commit",
          title: "Зафиксировать изменения",
          size: "full",
          noPadding: true,
          render: ({ hide }) => (
            <GitCommitDialog syncDir={syncDir} onDone={hide} workspace={workspace} />
          ),
        });
      },
    },
    {
      label: "Сбросить изменения",
      hidden: !hasChanges,
      leftSlot: <Icon icon="rotate_ccw" />,
      color: "danger",
      async onSelect() {
        const confirmed = await showConfirm({
          id: "git-reset-changes",
          title: "Сбросить изменения",
          description: "Это удалит все незафиксированные изменения. Отменить нельзя.",
          confirmText: "Сбросить",
          color: "danger",
        });
        if (!confirmed) return;

        await resetChanges.mutateAsync(undefined, {
          disableToastError: true,
          onSuccess() {
            showToast({
              id: "git-reset-success",
              message: "Изменения сброшены",
              color: "success",
            });
            fireAndForget(sync({ force: true }));
          },
          onError(err) {
            showErrorToast({
              id: "git-reset-error",
              title: "Ошибка сброса изменений",
              message: String(err),
            });
          },
        });
      },
    },
    { type: "separator", label: "Ветки", hidden: localBranches.length < 1 },
    ...localBranches.map((branch) => {
      const isCurrent = currentBranch === branch;
      return {
        label: branch,
        leftSlot: <Icon icon={isCurrent ? "check" : "empty"} />,
        submenuOpenOnClick: true,
        submenu: [
          {
            label: "Переключить",
            hidden: isCurrent,
            onSelect: () => tryCheckout(branch, false),
          },
          {
            label: (
              <>
                Merge into <InlineCode>{currentBranch}</InlineCode>
              </>
            ),
            hidden: isCurrent,
            async onSelect() {
              await mergeBranch.mutateAsync(
                { branch },
                {
                  disableToastError: true,
                  onSuccess() {
                    showToast({
                      id: "git-merged-branch",
                      message: (
                        <>
                          Merged <InlineCode>{branch}</InlineCode> into{" "}
                          <InlineCode>{currentBranch}</InlineCode>
                        </>
                      ),
                    });
                    fireAndForget(sync({ force: true }));
                  },
                  onError(err) {
                    showErrorToast({
                      id: "git-merged-branch-error",
                      title: "Ошибка слияния ветки",
                      message: String(err),
                    });
                  },
                },
              );
            },
          },
          {
            label: "Новая ветка...",
            async onSelect() {
              const name = await showPrompt({
                id: "git-new-branch-from",
                title: "Новая ветка",
                description: (
                  <>
                    Create a new branch from <InlineCode>{branch}</InlineCode>
                  </>
                ),
                label: "Имя ветки",
              });
              if (!name) return;

              await createBranch.mutateAsync(
                { branch: name, base: branch },
                {
                  disableToastError: true,
                  onError: (err) => {
                    showErrorToast({
                      id: "git-branch-error",
                      title: "Ошибка создания ветки",
                      message: String(err),
                    });
                  },
                },
              );
              tryCheckout(name, false);
            },
          },
          {
            label: "Переименовать...",
            async onSelect() {
              const newName = await showPrompt({
                id: "git-rename-branch",
                title: "Переименовать ветку",
                label: "Новое имя ветки",
                defaultValue: branch,
              });
              if (!newName || newName === branch) return;

              await renameBranch.mutateAsync(
                { oldName: branch, newName },
                {
                  disableToastError: true,
                  onSuccess() {
                    showToast({
                      id: "git-rename-branch-success",
                      message: (
                        <>
                          Renamed <InlineCode>{branch}</InlineCode> to{" "}
                          <InlineCode>{newName}</InlineCode>
                        </>
                      ),
                      color: "success",
                    });
                  },
                  onError(err) {
                    showErrorToast({
                      id: "git-rename-branch-error",
                      title: "Ошибка переименования ветки",
                      message: String(err),
                    });
                  },
                },
              );
            },
          },
          { type: "separator", hidden: isCurrent },
          {
            label: "Удалить",
            color: "danger",
            hidden: isCurrent,
            onSelect: async () => {
              const confirmed = await showConfirmDelete({
                id: "git-delete-branch",
                title: "Удалить ветку",
                description: (
                  <>
                    Permanently delete <InlineCode>{branch}</InlineCode>?
                  </>
                ),
              });
              if (!confirmed) {
                return;
              }

              const result = await deleteBranch.mutateAsync(
                { branch },
                {
                  disableToastError: true,
                  onError(err) {
                    showErrorToast({
                      id: "git-delete-branch-error",
                      title: "Ошибка удаления ветки",
                      message: String(err),
                    });
                  },
                },
              );

              if (result.type === "not_fully_merged") {
                const confirmed = await showConfirm({
                  id: "force-branch-delete",
                  title: "Ветка не полностью слита",
                  description: (
                    <>
                      <p>
                        Branch <InlineCode>{branch}</InlineCode> is not fully merged.
                      </p>
                      <p>Do you want to delete it anyway?</p>
                    </>
                  ),
                });
                if (confirmed) {
                  await deleteBranch.mutateAsync(
                    { branch, force: true },
                    {
                      disableToastError: true,
                      onError(err) {
                        showErrorToast({
                          id: "git-force-delete-branch-error",
                          title: "Ошибка принудительного удаления ветки",
                          message: String(err),
                        });
                      },
                    },
                  );
                }
              }
            },
          },
        ],
      } satisfies DropdownItem;
    }),
    ...remoteOnlyBranches.map((branch) => {
      const isCurrent = currentBranch === branch;
      return {
        label: branch,
        leftSlot: <Icon icon={isCurrent ? "check" : "empty"} />,
        submenuOpenOnClick: true,
        submenu: [
          {
            label: "Переключить",
            hidden: isCurrent,
            onSelect: () => tryCheckout(branch, false),
          },
          {
            label: "Удалить",
            color: "danger",
            async onSelect() {
              const confirmed = await showConfirmDelete({
                id: "git-delete-remote-branch",
                title: "Удалить remote-ветку",
                description: (
                  <>
                    Permanently delete <InlineCode>{branch}</InlineCode> from the remote?
                  </>
                ),
              });
              if (!confirmed) return;

              await deleteRemoteBranch.mutateAsync(
                { branch },
                {
                  disableToastError: true,
                  onSuccess() {
                    showToast({
                      id: "git-delete-remote-branch-success",
                      message: (
                        <>
                          Deleted remote branch <InlineCode>{branch}</InlineCode>
                        </>
                      ),
                      color: "success",
                    });
                  },
                  onError(err) {
                    showErrorToast({
                      id: "git-delete-remote-branch-error",
                      title: "Ошибка удаления remote-ветки",
                      message: String(err),
                    });
                  },
                },
              );
            },
          },
        ],
      } satisfies DropdownItem;
    }),
  ];

  return (
    <Dropdown fullWidth items={items} onOpen={regenerateKey}>
      <GitMenuButton>
        <InlineCode className="flex items-center gap-1">
          <Icon icon="git_branch" size="xs" className="opacity-50" />
          {currentBranch}
        </InlineCode>
        <div className="flex items-center gap-1.5">
          {ahead > 0 && (
            <span className="text-xs flex items-center gap-0.5">
              <span className="text-primary">↗</span>
              {ahead}
            </span>
          )}
          {behind > 0 && (
            <span className="text-xs flex items-center gap-0.5">
              <span className="text-info">↙</span>
              {behind}
            </span>
          )}
        </div>
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
          "px-3 h-md border-t border-border flex items-center justify-between text-text-subtle outline-none focus-visible:bg-surface-highlight",
        )}
        {...props}
      />
    );
  },
);

function SetupSyncDropdown({ workspaceMeta }: { workspaceMeta: WorkspaceMeta }) {
  const { value: hidden, set: setHidden } = useKeyValue<Record<string, boolean>>({
    key: "setup_sync",
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
          type: "content",
          label: banner,
        },
        {
          color: "success",
          label: "Открыть настройки рабочего пространства",
          leftSlot: <Icon icon="settings" />,
          onSelect: () => openWorkspaceSettings("data"),
        },
        { type: "separator" },
        {
          label: "Скрыть это сообщение",
          leftSlot: <Icon icon="eye_closed" />,
          async onSelect() {
            const confirmed = await showConfirm({
              id: "hide-sync-menu-prompt",
              title: "Скрыть сообщение настройки",
              description: "Вы можете настроить синхронизацию файловой системы или Git в настройках рабочего пространства",
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
    key: "setup_git_repo",
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
        { type: "content", label: banner },
        {
          label: "Инициализировать Git-репозиторий",
          leftSlot: <Icon icon="magic_wand" />,
          onSelect: initRepo,
        },
        { type: "separator" },
        {
          label: "Скрыть это сообщение",
          leftSlot: <Icon icon="eye_closed" />,
          async onSelect() {
            const confirmed = await showConfirm({
              id: "hide-git-init-prompt",
              title: "Скрыть настройку Git",
              description: "Вы можете инициализировать Git-репозиторий вне Yaak, чтобы вернуть это сообщение",
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
