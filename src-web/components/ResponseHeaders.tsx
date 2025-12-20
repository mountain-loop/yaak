import type { HttpResponse } from '@yaakapp-internal/models';
import { useMemo } from 'react';
import { CountBadge } from './core/CountBadge';
import { DetailsBanner } from './core/DetailsBanner';
import { Icon } from './core/Icon';
import { KeyValueRow, KeyValueRows } from './core/KeyValueRow';

interface Props {
  response: HttpResponse;
}

export function ResponseHeaders({ response }: Props) {
  const responseHeaders = useMemo(
    () =>
      [...response.headers].sort((a, b) =>
        a.name.toLocaleLowerCase().localeCompare(b.name.toLocaleLowerCase()),
      ),
    [response.headers],
  );
  const requestHeaders = useMemo(
    () =>
      [...response.requestHeaders].sort((a, b) =>
        a.name.toLocaleLowerCase().localeCompare(b.name.toLocaleLowerCase()),
      ),
    [response.requestHeaders],
  );
  return (
    <div className="overflow-auto h-full pb-4 gap-y-3 flex flex-col pr-0.5">
      <DetailsBanner
        defaultOpen
        storageKey={`${response.requestId}.response_headers`}
        summary={
          <h2 className="flex items-center">
            Response <CountBadge count={responseHeaders.length} />
          </h2>
        }
      >
        <KeyValueRows>
          {responseHeaders.map((h, i) => (
            <KeyValueRow
              labelColor="primary"
              // biome-ignore lint/suspicious/noArrayIndexKey: none
              key={i}
              label={
                <span className="flex items-center gap-1.5 -ml-1">
                  <Icon icon="arrow_left" size="2xs" className="text-text-subtlest opacity-60" />
                  h.name
                </span>
              }
            >
              {h.value}
            </KeyValueRow>
          ))}
        </KeyValueRows>
      </DetailsBanner>
      <DetailsBanner
        storageKey={`${response.requestId}.response_headers`}
        summary={
          <h2 className="flex items-center">
            Request <CountBadge count={requestHeaders.length} />
          </h2>
        }
      >
        <KeyValueRows>
          {requestHeaders.map((h, i) => (
            <KeyValueRow
              labelColor="primary"
              // biome-ignore lint/suspicious/noArrayIndexKey: none
              key={i}
              label={
                <span className="flex items-center gap-1.5 -ml-1">
                  <Icon icon="arrow_right" size="2xs" className="text-text-subtlest opacity-60" />
                  h.name
                </span>
              }
            >
              {h.value}
            </KeyValueRow>
          ))}
        </KeyValueRows>
      </DetailsBanner>
    </div>
  );
}
