import classNames from 'classnames';
import Papa from 'papaparse';
import { useMemo } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from '../core/Table';

interface Props {
  text: string | null;
  className?: string;
}

export function CsvViewer({ text, className }: Props) {
  return (
    <div className="overflow-auto h-full">
      <CsvViewerInner text={text} className={className} />
    </div>
  );
}

export function CsvViewerInner({ text, className }: { text: string | null; className?: string }) {
  const parsed = useMemo(() => {
    if (text == null) return null;
    return Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });
  }, [text]);

  if (parsed === null) return null;

  return (
    <div className="overflow-auto h-full">
      <Table className={classNames(className, 'text-sm')}>
        <TableHead>
          <TableRow>
            {parsed.meta.fields?.map((field) => (
              <TableHeaderCell key={field}>{field}</TableHeaderCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {parsed.data.map((row, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: none
            <TableRow key={i}>
              {parsed.meta.fields?.map((key) => (
                <TableCell key={key}>{row[key] ?? ''}</TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
