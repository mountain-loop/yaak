import { useGit } from '@yaakapp-internal/git';
import { useActiveWorkspace } from '../hooks/useActiveWorkspace';
import { useWorkspaceMeta } from '../hooks/useWorkspaceMeta';
import { showDialog } from '../lib/dialog';
import { Dropdown } from './core/Dropdown';
import { Icon } from './core/Icon';
import { GitCommitDialog } from './GitCommitDialog';

export function SyncDropdown() {
  const workspaceMeta = useWorkspaceMeta();

  if (workspaceMeta?.settingSyncDir == null) {
    return null;
  }

  return <SyncDropdownWithSyncDir syncDir={workspaceMeta.settingSyncDir} />;
}

function SyncDropdownWithSyncDir({ syncDir }: { syncDir: string }) {
  const workspace = useActiveWorkspace();
  const [{ status }, { init }] = useGit(syncDir);

  if (workspace == null) return null;

  const noRepo = status.error?.includes('not found');
  const items = noRepo
    ? [
        {
          key: 'init',
          label: 'Initialize',
          leftSlot: <Icon icon="git_branch" />,
          onSelect: init.mutate,
        },
      ]
    : [
        {
          key: 'commit',
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
      ];

  return (
    <Dropdown fullWidth items={items}>
      <button className="px-3 h-md border-t border-border flex items-center justify-between text-text-subtle">
        {noRepo ? 'Configure Git' : 'Git'}
        <Icon icon="git_branch" size="sm" className="text-text-subtle" />
      </button>
    </Dropdown>
  );
}
