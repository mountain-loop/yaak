import { useGit } from '@yaakapp-internal/git';
import { getActiveWorkspaceId, useActiveWorkspace } from '../hooks/useActiveWorkspace';
import { getWorkspaceMeta, useWorkspaceMeta } from '../hooks/useWorkspaceMeta';
import { showDialog } from '../lib/dialog';
import { showToast } from '../lib/toast';
import type { DropdownItem } from './core/Dropdown';
import { Dropdown } from './core/Dropdown';
import { Icon } from './core/Icon';
import { InlineCode } from './core/InlineCode';
import { GitCommitDialog } from './GitCommitDialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  TruncatedWideTableCell,
} from './core/Table';
import { formatDistanceToNowStrict } from 'date-fns';
import { syncWorkspace } from '../commands/commands';

export function GitDropdown() {
  const workspaceMeta = useWorkspaceMeta();

  if (workspaceMeta?.settingSyncDir == null) {
    return null;
  }

  return <SyncDropdownWithSyncDir syncDir={workspaceMeta.settingSyncDir} />;
}

function SyncDropdownWithSyncDir({ syncDir }: { syncDir: string }) {
  const workspace = useActiveWorkspace();
  const [{ status, log }, { init, push, checkout }] = useGit(syncDir);

  if (workspace == null) return null;

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
          label: 'Push',
          hidden: (status.data?.origins ?? []).length === 0,
          leftSlot: <Icon icon="arrow_up_from_line" />,
          onSelect: async () => {
            const message = await push.mutateAsync();
            if (message === 'nothing_to_push') {
              showToast({ id: 'push-success', message: 'Nothing to push', color: 'info' });
            } else {
              showToast({ id: 'push-success', message: 'Push successful', color: 'success' });
            }
          },
        },
        ...(status.data?.branches ?? []).map((branch) => ({
          label: branch,
          leftSlot: <Icon icon="git_branch" />,
          onSelect: async () => {
            const workspaceId = getActiveWorkspaceId();
            const workspaceMeta = getWorkspaceMeta();
            if (
              workspaceId == null ||
              workspaceMeta == null ||
              workspaceMeta.settingSyncDir == null
            )
              return;

            await checkout.mutateAsync({ branch });
            await syncWorkspace.mutateAsync({ workspaceId, syncDir: workspaceMeta.settingSyncDir, force: true });
          },
        })),
        {
          label: 'History',
          hidden: (log.data ?? []).length === 0,
          leftSlot: <Icon icon="history" />,
          onSelect: async () => {
            showDialog({
              id: 'git-history',
              size: 'md',
              title: 'Commit History',
              render: () => {
                return (
                  <Table>
                    <TableHead>
                      <TableRow>
                        <TableHeaderCell>Message</TableHeaderCell>
                        <TableHeaderCell>Author</TableHeaderCell>
                        <TableHeaderCell>When</TableHeaderCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {(log.data ?? []).map((l, i) => (
                        <TableRow key={i}>
                          <TruncatedWideTableCell>{l.message}</TruncatedWideTableCell>
                          <TableCell className="font-bold">{l.author.name ?? 'Unknown'}</TableCell>
                          <TableCell className="text-text-subtle">
                            <span title={l.when}>{formatDistanceToNowStrict(l.when)} ago</span>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                );
              },
            });
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
