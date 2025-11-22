import type { HttpResponse } from '@yaakapp-internal/models';
import classNames from 'classnames';
import Papa from 'papaparse';
import { useMemo } from 'react';
import { useResponseBodyText } from '../../hooks/useResponseBodyText';

interface Props {
  response: HttpResponse;
  className?: string;
}

export function CsvViewer({ response, className }: Props) {
  const body = useResponseBodyText({ response, filter: null });

  const parsed = useMemo(() => {
    if (body.data == null) return null;
    return Papa.parse<string[]>(body.data);
  }, [body]);

  if (parsed === null) return null;

  return (
    <div className="overflow-auto h-full">
      <table className={classNames(className, 'text-sm')}>
        <tbody>
          {parsed.data.map((row, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: <explanation>
            <tr key={i} className={classNames('border-l border-t', i > 0 && 'border-b')}>
              {row.map((col, j) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: <explanation>
                <td key={j} className="border-r px-1.5">
                  {col}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
