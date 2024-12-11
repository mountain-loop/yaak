import { useActiveWorkspace } from '../hooks/useActiveWorkspace';
import { Dropdown } from './core/Dropdown';
import { Icon } from './core/Icon';
import { useDialog } from './DialogContext';
import { GitCommitDialog } from './GitCommitDialog';

export function SyncDropdown({ syncDir }: { syncDir: string }) {
  const workspace = useActiveWorkspace();
  const dialog = useDialog();

  if (workspace == null) return null;

  return (
    <Dropdown
      fullWidth
      items={[
        {
          key: 'commit',
          label: 'Commit',
          leftSlot: <Icon icon="git_branch" />,
          onSelect() {
            dialog.show({
              id: 'commit',
              title: 'Commit Changes',
              size: 'full',
              className: '!max-h-[min(80vh,40rem)] !max-w-[min(50rem,90vw)]',
              render: ({hide}) => <GitCommitDialog syncDir={syncDir} onDone={hide} workspace={workspace} />,
            });
          },
        },
        // {
        //     key: 'history',
        //     label: 'History',
        //     leftSlot: <Icon icon="clock" />,
        //     onSelect() {
        //         dialog.show({
        //             id: 'branch-history',
        //             size: 'full',
        //             className: '!max-h-[min(80vh,40rem)] !max-w-[min(50rem,90vw)]',
        //             title: 'Branch History',
        //             render: ({ hide }) => <SyncHistoryDialog workspaceId={workspace.id} hide={hide} />,
        //         });
        //     },
        // },
        // { type: 'separator', label: 'master' },
        // {
        //     key: 'checkpoint',
        //     label: 'Commit Changes',
        //     leftSlot: <Icon icon="git_commit_vertical" />,
        //     onSelect() {
        //         dialog.show({
        //             id: 'commit-changes',
        //             size: 'full',
        //             className: '!max-h-[min(80vh,40rem)] !max-w-[min(50rem,90vw)]',
        //             title: 'Commit Changes',
        //             render: ({ hide }) => <SyncCommitDialog workspaceId={workspace.id} hide={hide} />,
        //         });
        //     },
        // },
      ]}
    >
      <button className="px-3 h-md border-t border-border flex items-center justify-between text-text-subtle">
        Configure Sync
        <Icon icon="git_branch" size="sm" className="text-text-subtle" />
      </button>
    </Dropdown>
  );
}
