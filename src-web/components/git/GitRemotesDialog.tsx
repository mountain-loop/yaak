import { useGit } from '@yaakapp-internal/git';
import { showDialog } from '../../lib/dialog';
import { Button } from '../core/Button';
import { IconButton } from '../core/IconButton';
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from '../core/Table';
import { gitCallbacks } from './callbacks';
import { addGitRemote } from './showAddRemoteDialog';

interface Props {
  dir: string;
  onDone: () => void;
}

export function GitRemotesDialog({ dir }: Props) {
  const [{ remotes }, { rmRemote }] = useGit(dir, gitCallbacks(dir));

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
                onClick={() => addGitRemote(dir)}
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
