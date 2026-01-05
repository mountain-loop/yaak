import { openUrl } from '@tauri-apps/plugin-opener';
import type { HttpResponse } from '@yaakapp-internal/models';
import { useMemo } from 'react';
import { CountBadge } from './core/CountBadge';
import { DetailsBanner } from './core/DetailsBanner';
import { IconButton } from './core/IconButton';
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
      <DetailsBanner storageKey={`${response.requestId}.general`} summary={<h2>Info</h2>}>
        <KeyValueRows>
          <KeyValueRow labelColor="secondary" label="Request URL">
            <div className="flex items-center gap-1">
              <span className="select-text cursor-text">{response.url}</span>
              <IconButton
                iconSize="sm"
                className="inline-block w-auto !h-auto opacity-50 hover:opacity-100"
                icon="external_link"
                onClick={() => openUrl(response.url)}
                title="Open in browser"
              />
            </div>
          </KeyValueRow>
          <KeyValueRow labelColor="secondary" label="Remote Address">
            {response.remoteAddr ?? <span className="text-text-subtlest">--</span>}
          </KeyValueRow>
          <KeyValueRow labelColor="secondary" label="Version">
            {response.version ?? <span className="text-text-subtlest">--</span>}
          </KeyValueRow>
        </KeyValueRows>
      </DetailsBanner>
      <DetailsBanner
        storageKey={`${response.requestId}.request_headers`}
        summary={
          <h2 className="flex items-center">
            Request Headers <CountBadge showZero count={requestHeaders.length} />
          </h2>
        }
      >
        {requestHeaders.length === 0 ? (
          <NoHeaders />
        ) : (
          <KeyValueRows>
            {requestHeaders.map((h, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: none
              <KeyValueRow labelColor="primary" key={i} label={h.name}>
                {h.value}
              </KeyValueRow>
            ))}
          </KeyValueRows>
        )}
      </DetailsBanner>
      <DetailsBanner
        defaultOpen
        storageKey={`${response.requestId}.response_headers`}
        summary={
          <h2 className="flex items-center">
            Response Headers <CountBadge showZero count={responseHeaders.length} />
          </h2>
        }
      >
        {responseHeaders.length === 0 ? (
          <NoHeaders />
        ) : (
          <KeyValueRows>
            {responseHeaders.map((h, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: none
              <KeyValueRow labelColor="info" key={i} label={h.name}>
                {h.value}
              </KeyValueRow>
            ))}
          </KeyValueRows>
        )}
      </DetailsBanner>
    </div>
  );
}

function NoHeaders() {
  return <span className="text-text-subtlest text-sm italic">No Headers</span>;
}
