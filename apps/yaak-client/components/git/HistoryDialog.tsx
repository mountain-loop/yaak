import { useGitLog } from "@yaakapp-internal/git";
import { formatDistanceToNowStrict } from "date-fns";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  TruncatedWideTableCell,
} from "@yaakapp-internal/ui";

export function HistoryDialog({ dir }: { dir: string }) {
  const log = useGitLog(dir);

  return (
    <div className="pl-5 pr-1 pb-1">
      <Table scrollable className="px-1">
        <TableHead>
          <TableRow>
            <TableHeaderCell>Message</TableHeaderCell>
            <TableHeaderCell>Author</TableHeaderCell>
            <TableHeaderCell>When</TableHeaderCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {(log.data ?? []).map((l) => (
            <TableRow key={l.oid}>
              <TruncatedWideTableCell>
                {l.message || <em className="text-text-subtle">No message</em>}
              </TruncatedWideTableCell>
              <TableCell>
                <span title={`Email: ${l.author.email}`}>{l.author.name || "Unknown"}</span>
              </TableCell>
              <TableCell className="text-text-subtle">
                <span title={l.when}>{formatDistanceToNowStrict(l.when)} ago</span>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
