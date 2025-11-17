import { useGit } from '@yaakapp-internal/git';
import { useCallback } from 'react';
import { showDialog } from '../../lib/dialog';
import { showPromptForm } from '../../lib/prompt-form';
import { Button } from '../core/Button';
import { IconButton } from '../core/IconButton';
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from '../core/Table';
import { gitCallbacks } from './callbacks';

interface Props {
  dir: string;
  onDone: () => void;
}

export function GitRemotesDialog({ dir }: Props) {
  const [{ remotes }, { addRemote, rmRemote }] = useGit(dir, gitCallbacks);
  const handleAddRemote = useCallback(async () => {
    const r = await showPromptForm({
      id: 'add-remote',
      title: 'Add Remote',
      inputs: [
        { type: 'text', label: 'Name', name: 'name' },
        { type: 'text', label: 'URL', name: 'url' },
      ],
    });
    if (r == null) return;
    const name = String(r.name ?? '');
    const url = String(r.url ?? '');
    addRemote.mutate({ name, url });
  }, [addRemote]);

  return (
    <div>
      <Table>
        <TableHead>
          <TableRow>
            <TableHeaderCell>Name</TableHeaderCell>
            <TableHeaderCell>URL</TableHeaderCell>
            <TableHeaderCell>
              <Button
                className="text-text-subtle ml-auto"
                size="2xs"
                color="primary"
                title="Add remote"
                variant="border"
                isLoading={addRemote.isPending}
                onClick={handleAddRemote}
              >
                Add Remote
              </Button>
            </TableHeaderCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {remotes.data?.map((r, i) => (
            <TableRow key={i}>
              <TableCell>{r.name}</TableCell>
              <TableCell>{r.url}</TableCell>
              <TableCell>
                <IconButton
                  size="sm"
                  className="text-text-subtle ml-auto"
                  icon="trash"
                  title="Remove remote"
                  isLoading={rmRemote.isPending}
                  onClick={() => rmRemote.mutate({ name: r.name })}
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

GitRemotesDialog.show = function (dir: string) {
  showDialog({
    id: 'git-remotes',
    title: 'Manage Remotes',
    size: 'md',
    render: ({ hide }) => <GitRemotesDialog onDone={hide} dir={dir} />,
  });
};
