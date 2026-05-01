import { invoke } from "@tauri-apps/api/core";
import type { HttpResponse, HttpResponseEvent } from "@yaakapp-internal/models";
import { deleteModel, httpResponsesAtom } from "@yaakapp-internal/models";
import classNames from "classnames";
import { useAtomValue } from "jotai";
import type { ComponentType, ReactNode } from "react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { activeWorkspaceIdAtom } from "../hooks/useActiveWorkspace";
import { allRequestsAtom } from "../hooks/useAllRequests";
import { useDeleteSendHistory } from "../hooks/useDeleteSendHistory";
import { useResponseBodyBytes, useResponseBodyText } from "../hooks/useResponseBodyText";
import { getMimeTypeFromContentType } from "../lib/contentType";
import { getContentTypeFromHeaders } from "../lib/model_util";
import { Button } from "./core/Button";
import { CountBadge } from "./core/CountBadge";
import { IconButton } from "./core/IconButton";
import { HttpMethodTagRaw } from "./core/HttpMethodTag";
import { HttpResponseDurationTag } from "./core/HttpResponseDurationTag";
import { HttpStatusTag } from "./core/HttpStatusTag";
import { KeyValueRow, KeyValueRows } from "./core/KeyValueRow";
import { LoadingIcon } from "./core/LoadingIcon";
import { HStack } from "./core/Stacks";
import { EmptyStateText } from "./EmptyStateText";
import { ErrorBoundary } from "./ErrorBoundary";
import { HeaderSize } from "./HeaderSize";
import { HttpResponseTimeline } from "./HttpResponseTimeline";
import { RequestBodyViewer } from "./RequestBodyViewer";
import { AudioViewer } from "./responseViewers/AudioViewer";
import { CsvViewer } from "./responseViewers/CsvViewer";
import { EventStreamViewer } from "./responseViewers/EventStreamViewer";
import { HTMLOrTextViewer } from "./responseViewers/HTMLOrTextViewer";
import { ImageViewer } from "./responseViewers/ImageViewer";
import { MultipartViewer } from "./responseViewers/MultipartViewer";
import { SvgViewer } from "./responseViewers/SvgViewer";
import { VideoViewer } from "./responseViewers/VideoViewer";

const PdfViewer = lazy(() =>
  import("./responseViewers/PdfViewer").then((m) => ({ default: m.PdfViewer })),
);

const PAGE_SIZE = 50;

interface HistoryEntry {
  response: HttpResponse;
  requestName: string;
  requestMethod: string;
}

export function HttpHistoryPage() {
  const allResponses = useAtomValue(httpResponsesAtom);
  const allRequests = useAtomValue(allRequestsAtom);
  const activeWorkspaceId = useAtomValue(activeWorkspaceIdAtom);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const deleteSendHistory = useDeleteSendHistory();

  useEffect(() => {
    setExpandedIds(new Set());
    setVisibleCount(PAGE_SIZE);
  }, [activeWorkspaceId]);

  const entries = useMemo<HistoryEntry[]>(() => {
    const requestsById = new Map(allRequests.map((r) => [r.id, r]));
    const out: HistoryEntry[] = [];
    for (const response of allResponses) {
      if (response.workspaceId !== activeWorkspaceId) continue;
      const request = requestsById.get(response.requestId) ?? null;
      const isGraphql = response.requestBodyType === "graphql";
      out.push({
        response,
        requestName:
          response.requestName ?? (request == null ? "(deleted request)" : ""),
        requestMethod: isGraphql ? "graphql" : (response.method ?? "unknown"),
      });
    }
    return out;
  }, [allResponses, allRequests, activeWorkspaceId]);

  const toggleExpanded = useCallback(
    (id: string) =>
      setExpandedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    [],
  );

  const handleDelete = useCallback((response: HttpResponse) => {
    setExpandedIds((prev) => {
      if (!prev.has(response.id)) return prev;
      const next = new Set(prev);
      next.delete(response.id);
      return next;
    });
    void deleteModel(response);
  }, []);

  return (
    <div className="h-full w-full flex flex-col bg-surface text-text">
      <HeaderSize size="lg">
        <div className="flex items-center gap-3 px-3 h-full">
          <h1 className="text-sm font-semibold">History</h1>
          <span className="text-xs text-text-subtle">{entries.length} requests</span>
          {expandedIds.size > 0 && (
            <Button size="2xs" variant="border" onClick={() => setExpandedIds(new Set())}>
              Collapse All
            </Button>
          )}
          <div className="flex-1" />
          {entries.length > 0 && (
            <Button
              size="2xs"
              variant="border"
              onClick={async () => {
                const deleted = await deleteSendHistory.mutateAsync();
                if (deleted) setExpandedIds(new Set());
              }}
            >
              Clear All
            </Button>
          )}
        </div>
      </HeaderSize>

      <div className="flex-1 overflow-y-auto">
        {entries.length === 0 ? (
          <EmptyStateText>No request history yet</EmptyStateText>
        ) : (
          <>
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-surface z-10">
                <tr className="text-left text-text-subtle text-xs uppercase">
                  <th className="pl-4 pr-1 py-2 font-medium w-[1.5rem]" />
                  <th className="px-4 py-2 font-medium w-[5rem]">Status</th>
                  <th className="px-4 py-2 font-medium w-[4rem]">Method</th>
                  <th className="px-4 py-2 font-medium">Request</th>
                  <th className="px-4 py-2 font-medium w-[6rem] text-right">Time</th>
                  <th className="px-4 py-2 font-medium w-[14rem] text-right">Timestamp</th>
                  <th className="w-[2rem]" />
                </tr>
              </thead>
              <tbody>
                {entries.slice(0, visibleCount).map((entry) => (
                  <HistoryRow
                    key={entry.response.id}
                    entry={entry}
                    isExpanded={expandedIds.has(entry.response.id)}
                    onToggle={toggleExpanded}
                    onDelete={handleDelete}
                  />
                ))}
              </tbody>
            </table>
            {visibleCount < entries.length && (
              <div className="flex justify-center py-3">
                <Button
                  size="xs"
                  variant="border"
                  onClick={() => setVisibleCount((n) => n + PAGE_SIZE)}
                >
                  Load More ({entries.length - visibleCount} remaining)
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function HistoryRow({
  entry,
  isExpanded,
  onToggle,
  onDelete,
}: {
  entry: HistoryEntry;
  isExpanded: boolean;
  onToggle: (id: string) => void;
  onDelete: (response: HttpResponse) => void;
}) {
  const { response, requestName, requestMethod } = entry;

  return (
    <>
      <tr
        className={classNames("cursor-pointer transition-colors group hover:bg-surface-highlight")}
        onClick={() => onToggle(response.id)}
      >
        <td className="pl-4 pr-1 py-2">
          <div
            className={classNames(
              "transition-transform w-0 h-0",
              "border-t-[0.3em] border-b-[0.3em] border-l-[0.5em] border-r-0",
              "border-t-transparent border-b-transparent border-l-text-subtle",
              isExpanded && "rotate-90",
            )}
          />
        </td>
        <td className="px-4 py-2">
          <HttpStatusTag response={response} short />
        </td>
        <td className="px-4 py-2">
          <HttpMethodTagRaw method={requestMethod} className="text-xs" forceColor />
        </td>
        <td className="px-4 py-2">
          <div className="truncate font-mono" title={response.url}>
            {response.url}
          </div>
          {requestName && (
            <div className="truncate text-text-subtlest text-xs" title={requestName}>
              {requestName}
            </div>
          )}
        </td>
        <td className="px-4 py-2 text-right text-text-subtle">
          <HttpResponseDurationTag response={response} />
        </td>
        <td className="px-4 py-2 text-right text-text-subtle font-mono text-xs tabular-nums">
          {formatTimestamp(response.createdAt)}
        </td>
        <td className="pr-4 py-2 w-[2rem]">
          <IconButton
            iconSize="sm"
            icon="trash"
            title="Delete response"
            className="!bg-transparent !shadow-none opacity-50 hover:!opacity-100"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(response);
            }}
          />
        </td>
      </tr>
      {isExpanded && (
        <tr className="">
          <td colSpan={7}>
            <HistoryDetail response={response} />
          </td>
        </tr>
      )}
    </>
  );
}

function HistoryDetail({ response }: { response: HttpResponse }) {
  const [activeTab, setActiveTab] = useState<string>("body");
  const contentType = getContentTypeFromHeaders(response.headers);
  const mimeType = contentType == null ? null : getMimeTypeFromContentType(contentType).essence;
  const [localEvents, setLocalEvents] = useState<HttpResponseEvent[]>([]);
  useEffect(() => {
    let cancelled = false;
    void invoke<HttpResponseEvent[]>("cmd_get_http_response_events", {
      responseId: response.id,
    }).then((events) => {
      if (!cancelled) setLocalEvents(events);
    });
    return () => {
      cancelled = true;
    };
  }, [response.id]);
  const queryParams = useMemo(() => {
    try {
      return Array.from(new URL(response.url).searchParams.entries());
    } catch {
      return [];
    }
  }, [response.url]);

  const requestHeaders = useMemo(
    () =>
      [...response.requestHeaders].sort((a, b) =>
        a.name.toLocaleLowerCase().localeCompare(b.name.toLocaleLowerCase()),
      ),
    [response.requestHeaders],
  );
  const responseHeaders = useMemo(
    () =>
      [...response.headers].sort((a, b) =>
        a.name.toLocaleLowerCase().localeCompare(b.name.toLocaleLowerCase()),
      ),
    [response.headers],
  );

  const tabs = [
    { key: "body", label: "Body" },
    {
      key: "headers",
      label: "Headers",
      badge: `${requestHeaders.length} / ${responseHeaders.length}`,
    },
    { key: "timeline", label: "Timeline", badge: localEvents.length },
  ];

  return (
    <div className="px-4 py-3">
      <HStack space={1} className="mb-2">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setActiveTab(t.key)}
            className={classNames(
              "px-2 py-1 rounded text-xs font-medium transition-colors",
              activeTab === t.key ? "text-text" : "text-text-subtle hover:text-text",
            )}
          >
            {t.label}
            {t.badge != null && t.badge !== 0 && (
              <span className="ml-1.5 opacity-70">{t.badge}</span>
            )}
          </button>
        ))}
      </HStack>

      {activeTab === "body" && (
        <div className="flex gap-3 items-start">
          <div className="flex-1 min-w-0">
            {queryParams.length > 0 && (
              <div className="rounded border border-dashed border-border-subtle bg-surface p-2 mb-2">
                <h4 className="text-xs font-medium text-text-subtle uppercase mb-1">
                  Query Parameters
                </h4>
                <table className="w-full text-xs">
                  <tbody>
                    {queryParams.map(([key, value], i) => (
                      // oxlint-disable-next-line react/no-array-index-key
                      <tr key={`${key}-${i}`}>
                        <td className="pr-3 py-0.5 font-mono text-primary whitespace-nowrap">
                          {key}
                        </td>
                        <td className="py-0.5 font-mono break-all">{value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <RequestBodyPane response={response} />
          </div>
          <div className="flex-1 min-w-0 rounded border border-dashed border-border-subtle bg-surface [&_.cm-editor]:!border-0 [&_.border-dashed]:!border-0">
            <h3 className="text-xs font-medium text-text-subtle uppercase p-2 pb-0">
              Response Body
            </h3>
            <div className="h-[10rem] min-h-[4rem] max-h-[60rem] resize-y overflow-auto p-2 pt-1">
              <ResponseBodySection response={response} mimeType={mimeType} />
            </div>
          </div>
        </div>
      )}

      {activeTab === "headers" && (
        <div className="flex gap-3 items-start">
          <div className="flex-1 min-w-0 max-h-[30rem] overflow-auto flex flex-col gap-2">
            <div className="rounded border border-dashed border-border-subtle bg-surface p-2">
              <h3 className="text-xs font-medium text-text-subtle uppercase mb-1">Info</h3>
              <KeyValueRows>
                <KeyValueRow labelColor="secondary" label="Request URL">
                  <span className="select-text cursor-text break-all">{response.url}</span>
                </KeyValueRow>
                <KeyValueRow labelColor="secondary" label="Remote Address">
                  {response.remoteAddr ?? <span className="text-text-subtlest">--</span>}
                </KeyValueRow>
                <KeyValueRow labelColor="secondary" label="Version">
                  {response.version ?? <span className="text-text-subtlest">--</span>}
                </KeyValueRow>
              </KeyValueRows>
            </div>
            <div className="rounded border border-dashed border-border-subtle bg-surface p-2">
              <h3 className="text-xs font-medium text-text-subtle uppercase mb-1 flex items-center">
                Request Headers
                <CountBadge showZero count={requestHeaders.length} />
              </h3>
              {requestHeaders.length === 0 ? (
                <span className="text-text-subtlest text-sm italic">No Headers</span>
              ) : (
                <KeyValueRows>
                  {requestHeaders.map((h, i) => (
                    // oxlint-disable-next-line react/no-array-index-key
                    <KeyValueRow labelColor="primary" key={i} label={h.name}>
                      {h.value}
                    </KeyValueRow>
                  ))}
                </KeyValueRows>
              )}
            </div>
          </div>
          <div className="flex-1 min-w-0 max-h-[30rem] overflow-auto">
            <div className="rounded border border-dashed border-border-subtle bg-surface p-2">
              <h3 className="text-xs font-medium text-text-subtle uppercase mb-1 flex items-center">
                Response Headers
                <CountBadge showZero count={responseHeaders.length} />
              </h3>
              {responseHeaders.length === 0 ? (
                <span className="text-text-subtlest text-sm italic">No Headers</span>
              ) : (
                <KeyValueRows>
                  {responseHeaders.map((h, i) => (
                    // oxlint-disable-next-line react/no-array-index-key
                    <KeyValueRow labelColor="info" key={i} label={h.name}>
                      {h.value}
                    </KeyValueRow>
                  ))}
                </KeyValueRows>
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === "timeline" && (
        <div className="max-h-[30rem] overflow-auto rounded border border-dashed border-border-subtle bg-surface p-2">
          <HttpResponseTimeline response={response} viewMode="timeline" events={localEvents} />
        </div>
      )}
    </div>
  );
}

function ResponseBodySection({
  response,
  mimeType,
}: {
  response: HttpResponse;
  mimeType: string | null;
}) {
  if (response.state === "initialized") {
    return (
      <BodyEmpty>
        <HStack space={3}>
          <LoadingIcon className="text-text-subtlest" />
          Sending Request
        </HStack>
      </BodyEmpty>
    );
  }

  if (response.error) {
    return <BodyEmpty>{response.error}</BodyEmpty>;
  }

  if (response.state === "closed" && ((response.contentLength ?? 0) === 0 || !response.bodyPath)) {
    return <BodyEmpty>No response body</BodyEmpty>;
  }

  return (
    <ErrorBoundary name="History Response Viewer">
      <Suspense>
        {mimeType?.match(/^text\/event-stream/i) ? (
          <EventStreamViewer response={response} />
        ) : mimeType?.match(/^image\/svg/) ? (
          <HistorySvgViewer response={response} />
        ) : mimeType?.match(/^image/i) ? (
          <EnsureComplete response={response} Component={ImageViewer} />
        ) : mimeType?.match(/^audio/i) ? (
          <EnsureComplete response={response} Component={AudioViewer} />
        ) : mimeType?.match(/^video/i) ? (
          <EnsureComplete response={response} Component={VideoViewer} />
        ) : mimeType?.match(/^multipart/i) ? (
          <HistoryMultipartViewer response={response} />
        ) : mimeType?.match(/pdf/i) ? (
          <EnsureComplete response={response} Component={PdfViewer} />
        ) : mimeType?.match(/csv|tab-separated/i) ? (
          <HistoryCsvViewer response={response} />
        ) : (
          <HTMLOrTextViewer response={response} pretty textViewerClassName="bg-surface" />
        )}
      </Suspense>
    </ErrorBoundary>
  );
}

function EnsureComplete({
  response,
  Component,
}: {
  response: HttpResponse;
  Component: ComponentType<{ bodyPath: string }>;
}) {
  if (response.bodyPath === null) return <BodyEmpty>No response body</BodyEmpty>;
  if (response.state !== "closed") {
    return (
      <BodyEmpty>
        <LoadingIcon />
      </BodyEmpty>
    );
  }
  return <Component bodyPath={response.bodyPath} />;
}

function HistorySvgViewer({ response }: { response: HttpResponse }) {
  const body = useResponseBodyText({ response, filter: null });
  if (!body.data) return null;
  return <SvgViewer text={body.data} />;
}

function HistoryCsvViewer({ response }: { response: HttpResponse }) {
  const body = useResponseBodyText({ response, filter: null });
  return <CsvViewer text={body.data ?? null} />;
}

function HistoryMultipartViewer({ response }: { response: HttpResponse }) {
  const body = useResponseBodyBytes({ response });
  if (body.data == null) return null;
  const contentTypeHeader = getContentTypeFromHeaders(response.headers);
  const boundary = contentTypeHeader?.split("boundary=")[1] ?? "unknown";
  return <MultipartViewer data={body.data} boundary={boundary} idPrefix={response.id} />;
}

function RequestBodyPane({ response }: { response: HttpResponse }) {
  const hasBody = (response.requestContentLength ?? 0) > 0;
  return (
    <div className="rounded border border-dashed border-border-subtle bg-surface [&_.cm-editor]:!border-0 [&_.border-dashed]:!border-0">
      <h3 className="text-xs font-medium text-text-subtle uppercase p-2 pb-0">Request Body</h3>
      {hasBody ? (
        <div className="h-[10rem] min-h-[4rem] max-h-[60rem] resize-y overflow-auto p-2 pt-1">
          <RequestBodyViewer response={response} />
        </div>
      ) : (
        <div className="p-2 pt-1">
          <BodyEmpty>No request body</BodyEmpty>
        </div>
      )}
    </div>
  );
}

function BodyEmpty({ children }: { children: ReactNode }) {
  return (
    <div className="h-full flex items-center justify-center py-6 text-text-subtlest italic text-sm">
      {children}
    </div>
  );
}

function formatTimestamp(createdAt: string): string {
  const d = new Date(`${createdAt}Z`);
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`
  );
}
