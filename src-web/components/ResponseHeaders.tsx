import type { HttpResponse } from '@yaakapp-internal/models';
import { useMemo } from 'react';
import { KeyValueRow, KeyValueRows } from './core/KeyValueRow';

interface Props {
  response: HttpResponse;
}

export function ResponseHeaders({ response }: Props) {
  const sortedHeaders = useMemo(
    () => [...response.headers].sort((a, b) => a.name.localeCompare(b.name)),
    [response.headers],
  );
  return (
    <div className="overflow-auto h-full pb-4">
      <KeyValueRows>
        {sortedHeaders.map((h, i) => (
          <KeyValueRow labelColor="primary" key={i} label={h.name}>
            {h.value}
          </KeyValueRow>
        ))}
      </KeyValueRows>
    </div>
  );
}
