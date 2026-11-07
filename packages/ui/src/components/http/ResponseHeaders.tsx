import { format, formatDistanceToNowStrict } from "date-fns";
import type { ReactElement } from "react";
import { DetailsBanner } from "../DetailsBanner";
import { useEditorHost } from "../EditorHost";
import { EmptyStateText } from "../EmptyStateText";
import { HeadersTable } from "../HeadersTable";
import { IconButton } from "../IconButton";
import type { KeyValueRowProps } from "../KeyValueRow";
import { KeyValueRow as BaseKeyValueRow, KeyValueRows } from "../KeyValueRow";
import type { HttpResponseView } from "./types";

interface Props {
  response: HttpResponseView;
  /** More rows for the Info section, after the standard ones, each keyed */
  infoRows?: ReactElement[];
  /** Only the response's headers, for a pane whose request and info are shown elsewhere */
  responseOnly?: boolean;
}

export function ResponseHeaders({ response, infoRows, responseOnly }: Props) {
  const { openUrl, useDetailsBannerStoredValue } = useEditorHost();
  if (responseOnly) {
    return (
      <div className="overflow-auto h-full pb-4 pr-0.5">
        {response.headers.length === 0 ? (
          <EmptyStateText>No Headers</EmptyStateText>
        ) : (
          <KeyValueRows>
            {response.headers.map((h, i) => (
              // oxlint-disable-next-line react/no-array-index-key
              <KeyValueRow labelColor="info" key={i} label={h.name}>
                {h.value}
              </KeyValueRow>
            ))}
          </KeyValueRows>
        )}
      </div>
    );
  }
  return (
    <div className="overflow-auto h-full pb-4 gap-y-3 flex flex-col pr-0.5">
      <DetailsBanner
        storageKey={`${response.ownerId}.general`}
        summary={<h2>Info</h2>}
        useStoredValue={useDetailsBannerStoredValue}
      >
        <KeyValueRows>
          {[
            <KeyValueRow key="sent" labelColor="secondary" label="Sent">
              <time
                dateTime={new Date(response.startedAt).toISOString()}
                title={formatDistanceToNowStrict(response.startedAt, { addSuffix: true })}
              >
                {format(response.startedAt, "MMM d, yyyy, h:mm:ss a O")}
              </time>
            </KeyValueRow>,
            <KeyValueRow key="url" labelColor="secondary" label="Request URL">
              <div className="flex items-center gap-1">
                <span className="select-text cursor-text">{response.url}</span>
                {openUrl != null && (
                  <IconButton
                    iconSize="sm"
                    className="inline-block w-auto h-auto! opacity-50 hover:opacity-100"
                    icon="external_link"
                    onClick={() => openUrl(response.url)}
                    title="Open in browser"
                  />
                )}
              </div>
            </KeyValueRow>,
            <KeyValueRow key="remote" labelColor="secondary" label="Remote Address">
              {response.remoteAddr ?? <span className="text-text-subtlest">--</span>}
            </KeyValueRow>,
            <KeyValueRow key="version" labelColor="secondary" label="Version">
              {response.version ?? <span className="text-text-subtlest">--</span>}
            </KeyValueRow>,
            ...(infoRows ?? []),
          ]}
        </KeyValueRows>
      </DetailsBanner>
      <HeadersTable
        title="Request Headers"
        headers={response.requestHeaders}
        labelColor="primary"
        storageKey={`${response.ownerId}.request_headers`}
        useStoredValue={useDetailsBannerStoredValue}
      />
      <HeadersTable
        defaultOpen
        title="Response Headers"
        headers={response.headers}
        labelColor="info"
        storageKey={`${response.ownerId}.response_headers`}
        useStoredValue={useDetailsBannerStoredValue}
      />
    </div>
  );
}

/** A row that copies its value with the host's clipboard */
export function KeyValueRow(props: Omit<KeyValueRowProps, "copy">) {
  const { copy } = useEditorHost();
  return <BaseKeyValueRow {...props} copy={copy} />;
}
