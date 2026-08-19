import classNames from "classnames";
import Papa from "papaparse";
import { useMemo } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@yaakapp-internal/ui";

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
    return Papa.parse<string[]>(text, { skipEmptyLines: true });
  }, [text]);

  if (parsed === null) return null;

  const header = parsed.data[0] ?? [];
  const rows = parsed.data.slice(1);
  const columnCount = parsed.data.reduce((count, row) => Math.max(count, row.length), 0);
  const columnIndexes = Array.from({ length: columnCount }, (_, index) => index);

  return (
    <div className="overflow-auto h-full">
      <Table className={classNames(className, "text-sm")}>
        <TableHead>
          <TableRow>
            {columnIndexes.map((columnIndex) => (
              <TableHeaderCell key={columnIndex}>{header[columnIndex] ?? ""}</TableHeaderCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row, i) => (
            // oxlint-disable-next-line react/no-array-index-key
            <TableRow key={i}>
              {row.map((cell, columnIndex) => (
                // oxlint-disable-next-line react/no-array-index-key
                <TableCell key={columnIndex}>{cell}</TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
