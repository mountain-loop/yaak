import { formatSize } from "@yaakapp-internal/lib/formatSize";
import type { Flow } from "@yaakapp-internal/proxy-lib";
import {
  DetailsBanner,
  formatMillis,
  HeadersTable,
  KeyValueRow,
  KeyValueRows,
} from "@yaakapp-internal/ui";
import { useMemo } from "react";
import { EmptyState } from "./FlowBodyViewer";

const startedFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
  fractionalSecondDigits: 3,
  timeZoneName: "short",
});

const bytesFormat = new Intl.NumberFormat("en-US");

export function FlowHeaders({ flow }: { flow: Flow }) {
  const versions =
    flow.upstreamHttpVersion == null
      ? `${flow.clientHttpVersion} from the app`
      : `${flow.clientHttpVersion} from the app, ${flow.upstreamHttpVersion} to the server`;

  return (
    <div className="overflow-auto h-full pb-4 gap-y-3 flex flex-col pr-0.5">
      <DetailsBanner defaultOpen storageKey="flow.info" summary={<h2>Info</h2>}>
        <KeyValueRows>
          <KeyValueRow label="Started">
            {startedFormat.format(new Date(`${flow.startedAt}Z`))}
          </KeyValueRow>
          <KeyValueRow label="URL">{flow.url}</KeyValueRow>
          <KeyValueRow label="Remote Address">{flow.remoteAddr ?? <Missing />}</KeyValueRow>
          <KeyValueRow label="Version">{versions}</KeyValueRow>
          <KeyValueRow label="Timing">
            {flow.elapsedMs == null ? (
              <Missing />
            ) : flow.elapsedHeadersMs == null ? (
              `${formatMillis(flow.elapsedMs)} in all`
            ) : (
              `${formatMillis(flow.elapsedMs)} in all, headers after ${formatMillis(flow.elapsedHeadersMs)}`
            )}
          </KeyValueRow>
          <KeyValueRow label="Size">
            <span>
              {formatSize(flow.requestSize)} sent, {formatSize(flow.responseSize)} received{" "}
              <span className="text-text-subtlest">
                ({bytesFormat.format(flow.responseSize)} B)
              </span>
            </span>
          </KeyValueRow>
        </KeyValueRows>
      </DetailsBanner>
      <HeadersTable
        title="Request Headers"
        headers={flow.requestHeaders}
        labelColor="primary"
        storageKey="flow.request_headers"
      />
      <HeadersTable
        defaultOpen
        title="Response Headers"
        headers={flow.responseHeaders}
        labelColor="info"
        storageKey="flow.response_headers"
      />
    </div>
  );
}

export function FlowQuery({ flow }: { flow: Flow }) {
  const params = useMemo(() => queryParams(flow.url), [flow.url]);

  if (params.length === 0) {
    return <EmptyState>No query parameters</EmptyState>;
  }

  return (
    <div className="overflow-auto h-full pb-4">
      <KeyValueRows>
        {params.map(([name, value], i) => (
          // oxlint-disable-next-line react/no-array-index-key -- a name can repeat
          <KeyValueRow key={i} label={name} labelColor="primary">
            {value}
          </KeyValueRow>
        ))}
      </KeyValueRows>
    </div>
  );
}

export function queryParams(url: string): [string, string][] {
  try {
    return [...new URL(url).searchParams.entries()];
  } catch {
    return [];
  }
}

function Missing() {
  return <span className="text-text-subtlest">--</span>;
}
