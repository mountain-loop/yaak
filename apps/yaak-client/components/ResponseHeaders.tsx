import type { HttpResponse } from "@yaakapp-internal/models";
import { platform } from "@yaakapp-internal/platform";
import { HeadersTable, KeyValueRows } from "@yaakapp-internal/ui";
import { format, formatDistanceToNowStrict } from "date-fns";
import { DetailsBanner, useDetailsBannerStoredValue } from "./core/DetailsBanner";
import { IconButton } from "./core/IconButton";
import { KeyValueRow } from "./core/KeyValueRow";

interface Props {
  response: HttpResponse;
}

export function ResponseHeaders({ response }: Props) {
  return (
    <div className="overflow-auto h-full pb-4 gap-y-3 flex flex-col pr-0.5">
      <DetailsBanner storageKey={`${response.requestId}.general`} summary={<h2>Info</h2>}>
        <KeyValueRows>
          <KeyValueRow labelColor="secondary" label="Sent">
            <time
              dateTime={new Date(`${response.createdAt}Z`).toISOString()}
              title={formatDistanceToNowStrict(`${response.createdAt}Z`, { addSuffix: true })}
            >
              {format(`${response.createdAt}Z`, "MMM d, yyyy, h:mm:ss a O")}
            </time>
          </KeyValueRow>
          <KeyValueRow labelColor="secondary" label="Request URL">
            <div className="flex items-center gap-1">
              <span className="select-text cursor-text">{response.url}</span>
              <IconButton
                iconSize="sm"
                className="inline-block w-auto h-auto! opacity-50 hover:opacity-100"
                icon="external_link"
                onClick={() => platform.openUrl(response.url)}
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
      <HeadersTable
        title="Request Headers"
        headers={response.requestHeaders}
        labelColor="primary"
        storageKey={`${response.requestId}.request_headers`}
        useStoredValue={useDetailsBannerStoredValue}
      />
      <HeadersTable
        defaultOpen
        title="Response Headers"
        headers={response.headers}
        labelColor="info"
        storageKey={`${response.requestId}.response_headers`}
        useStoredValue={useDetailsBannerStoredValue}
      />
    </div>
  );
}
