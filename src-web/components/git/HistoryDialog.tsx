import type { GitCommit } from '@yaakapp-internal/git';
import { formatDistanceToNowStrict } from 'date-fns';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  TruncatedWideTableCell,
} from '../core/Table';

interface Props {
  log: GitCommit[];
}

export function HistoryDialog({ log }: Props) {
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
        {log.map((l, i) => (
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
}
