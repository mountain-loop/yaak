import {useGitStatus} from "@yaakapp-internal/git";
import { useActiveWorkspace } from '../hooks/useActiveWorkspace';
import { Dropdown } from './core/Dropdown';
import { Icon } from './core/Icon';
import { useToast } from './ToastContext';

export function SyncDropdown() {
  const workspace = useActiveWorkspace();
  const toast = useToast();
  const status = useGitStatus('/Users/gschier/Desktop/test-git');
  console.log("GIT STATUS", status);

  if (workspace == null) return null;

  return (
    <Dropdown
      fullWidth
      items={[
        {
          key: 'push',
          label: 'Manage Branches',
          leftSlot: <Icon icon="git_branch" />,
          onSelect() {
            toast.show({
              id: 'manage-branches',
              icon: 'info',
              color: 'notice',
              message: 'TODO: Implement branch manager',
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
