import type { HttpExchange, ProxyHeader } from '@yaakapp-internal/proxy-lib';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  TruncatedWideTableCell,
} from '@yaakapp-internal/ui';
import classNames from 'classnames';

interface Props {
  exchanges: HttpExchange[];
  style?: React.CSSProperties;
}

export function ExchangesTable({ exchanges, style }: Props) {
  if (exchanges.length === 0) {
    return <p className="text-text-subtlest text-sm">No traffic yet</p>;
  }

  return (
    <Table scrollable className="px-2" style={style}>
      <TableHead>
        <TableRow>
          <TableHeaderCell>Method</TableHeaderCell>
          <TableHeaderCell>URL</TableHeaderCell>
          <TableHeaderCell>Status</TableHeaderCell>
          <TableHeaderCell>Type</TableHeaderCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {exchanges.map((ex) => (
          <TableRow key={ex.id}>
            <TableCell className="font-mono text-2xs">{ex.method}</TableCell>
            <TruncatedWideTableCell className="font-mono text-2xs">{ex.url}</TruncatedWideTableCell>
            <TableCell>
              <StatusBadge status={ex.resStatus} error={ex.error} />
            </TableCell>
            <TableCell className="text-text-subtle text-xs">
              {getContentType(ex.resHeaders)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function StatusBadge({ status, error }: { status: number | null; error: string | null }) {
  if (error) return <span className="text-xs text-danger">Error</span>;
  if (status == null) return <span className="text-xs text-text-subtlest">—</span>;

  const color =
    status >= 500
      ? 'text-danger'
      : status >= 400
        ? 'text-warning'
        : status >= 300
          ? 'text-notice'
          : 'text-success';

  return <span className={classNames('text-xs font-mono', color)}>{status}</span>;
}

function getContentType(headers: ProxyHeader[]): string {
  const ct = headers.find((h) => h.name.toLowerCase() === 'content-type')?.value;
  if (ct == null) return '—';
  // Strip parameters (e.g. "; charset=utf-8")
  return ct.split(';')[0]?.trim() ?? ct;
}
