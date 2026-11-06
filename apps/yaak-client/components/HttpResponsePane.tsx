import type { HttpResponse, HttpResponseEvent } from "@yaakapp-internal/models";
import {
  CountBadge,
  type ExtraPaneTab,
  type HostBodyViewerArgs,
  HttpResponsePaneView,
  Icon,
  type ResponseTextViewerExtras,
  type TextFilterApi,
  Tooltip,
  VStack,
} from "@yaakapp-internal/ui";
import type { CSSProperties } from "react";
import { useCallback, useMemo } from "react";
import { useCancelHttpResponse } from "../hooks/useCancelHttpResponse";
import { useCopyHttpResponse } from "../hooks/useCopyHttpResponse";
import { useRequestBodyLoader, useResponseBodyLoader } from "../hooks/useHttpBodyLoaders";
import { useHttpResponseEvents } from "../hooks/useHttpResponseEvents";
import { usePinnedHttpResponse } from "../hooks/usePinnedHttpResponse";
import { useRecentFilters } from "../hooks/useRecentFilters";
import { useResponseViewMode } from "../hooks/useResponseViewMode";
import { useSaveResponse } from "../hooks/useSaveResponse";
import { useTimelineViewMode } from "../hooks/useTimelineViewMode";
import { httpResponseToView } from "../lib/httpViews";
import { getCookieCounts } from "../lib/model_util";
import { CopyButton } from "./CopyButton";
import { HotkeyList } from "./core/HotkeyList";
import { IconButton } from "./core/IconButton";
import { PillButton } from "./core/PillButton";
import { HttpResponseTimeline } from "./HttpResponseTimeline";
import { RecentHttpResponsesDropdown } from "./RecentHttpResponsesDropdown";
import { EventStreamViewer } from "./responseViewers/EventStreamViewer";
import { RecentFiltersDropdown } from "./responseViewers/RecentFiltersDropdown";

interface Props {
  style?: CSSProperties;
  className?: string;
  activeRequestId: string;
}

const TAB_TIMELINE = "timeline";

export type TimelineViewMode = "timeline" | "text";

interface RedirectDropWarning {
  droppedBodyCount: number;
  droppedHeaders: string[];
}

/** The shared response pane, bound to the pinned response of the active request */
export function HttpResponsePane({ style, className, activeRequestId }: Props) {
  const { activeResponse, setPinnedResponseId, responses } = usePinnedHttpResponse(activeRequestId);
  const [viewMode, setViewMode] = useResponseViewMode(activeResponse?.requestId);
  const [timelineViewMode, setTimelineViewMode] = useTimelineViewMode();

  const responseEvents = useHttpResponseEvents(activeResponse);
  const redirectDropWarning = useMemo(
    () => getRedirectDropWarning(responseEvents.data),
    [responseEvents.data],
  );
  const shouldShowRedirectDropWarning =
    activeResponse?.state === "closed" && redirectDropWarning != null;

  const cookieCounts = useMemo(() => getCookieCounts(responseEvents.data), [responseEvents.data]);
  const saveResponse = useSaveResponse(activeResponse ?? null);
  const copyResponse = useCopyHttpResponse(activeResponse ?? null);
  const cancel = useCancelHttpResponse(activeResponse?.id ?? null);
  const body = useResponseBodyLoader(activeResponse ?? null);
  const requestBody = useRequestBodyLoader(activeResponse ?? null);
  const textViewer = useResponseTextViewerExtras(activeResponse ?? null);

  const responseView = useMemo(
    () => (activeResponse == null ? null : httpResponseToView(activeResponse, responseEvents.data)),
    [activeResponse, responseEvents.data],
  );

  const extraTabs = useMemo<ExtraPaneTab[]>(
    () =>
      activeResponse == null
        ? []
        : [
            {
              tab: {
                value: TAB_TIMELINE,
                rightSlot: <CountBadge count={responseEvents.data?.length ?? 0} />,
                options: {
                  value: timelineViewMode,
                  onChange: (v) => setTimelineViewMode((v as TimelineViewMode) ?? "timeline"),
                  items: [
                    { label: "Timeline", value: "timeline" },
                    { label: "Timeline (Text)", shortLabel: "Timeline", value: "text" },
                  ],
                },
              },
              content: (
                <HttpResponseTimeline response={activeResponse} viewMode={timelineViewMode} />
              ),
            },
          ],
    [activeResponse, responseEvents.data?.length, setTimelineViewMode, timelineViewMode],
  );

  const renderBodyViewer = useCallback(
    ({ mimeType, viewMode }: HostBodyViewerArgs) =>
      activeResponse != null && mimeType?.match(/^text\/event-stream/i) && viewMode === "pretty" ? (
        <EventStreamViewer response={activeResponse} />
      ) : null,
    [activeResponse],
  );

  return (
    <HttpResponsePaneView
      style={style}
      className={className}
      response={responseView}
      body={body}
      requestBody={requestBody}
      emptyState={
        <HotkeyList hotkeys={["request.send", "model.create", "sidebar.focus", "url_bar.focus"]} />
      }
      viewMode={viewMode === "raw" ? "raw" : "pretty"}
      onViewModeChange={setViewMode}
      activeTabKey={activeRequestId}
      onSaveBody={saveResponse.mutate}
      onCopyBody={copyResponse.mutate}
      onCancel={cancel.mutate}
      cookieCounts={cookieCounts}
      extraTabs={extraTabs}
      textViewer={textViewer}
      renderBodyViewer={renderBodyViewer}
      renderCopyButton={renderCopyButton}
      statusLineCenter={
        shouldShowRedirectDropWarning ? (
          <Tooltip
            tabIndex={0}
            className="my-auto pl-3 shrink-0 max-w-full justify-self-end overflow-hidden"
            content={
              <VStack alignItems="start" space={1} className="text-xs">
                <span className="font-medium text-warning">Redirect changed this request</span>
                {redirectDropWarning.droppedBodyCount > 0 && (
                  <span>
                    Body dropped on {redirectDropWarning.droppedBodyCount}{" "}
                    {redirectDropWarning.droppedBodyCount === 1 ? "redirect hop" : "redirect hops"}
                  </span>
                )}
                {redirectDropWarning.droppedHeaders.length > 0 && (
                  <span>
                    Headers dropped:{" "}
                    <span className="font-mono">
                      {redirectDropWarning.droppedHeaders.join(", ")}
                    </span>
                  </span>
                )}
                <span className="text-text-subtle">See Timeline for details.</span>
              </VStack>
            }
          >
            <span className="inline-flex min-w-0">
              <PillButton
                color="warning"
                className="font-sans text-sm shrink! max-w-full"
                innerClassName="flex items-center"
                leftSlot={<Icon icon="alert_triangle" size="xs" color="warning" />}
              >
                <span className="truncate">{getRedirectWarningLabel(redirectDropWarning)}</span>
              </PillButton>
            </span>
          </Tooltip>
        ) : null
      }
      statusLineRight={
        activeResponse != null && (
          <RecentHttpResponsesDropdown
            responses={responses}
            activeResponse={activeResponse}
            onPinnedResponseId={setPinnedResponseId}
          />
        )
      }
    />
  );
}

/** The client's additions to the response text viewer: filter history, save and copy */
function useResponseTextViewerExtras(
  response: HttpResponse | null,
): ResponseTextViewerExtras | undefined {
  const filterStateKey = `response.body.${response?.requestId ?? ""}`;
  const { recentFilters, addFilter, removeFilter, togglePin, clearFilters } =
    useRecentFilters(filterStateKey);
  const saveResponse = useSaveResponse(response);
  const copyResponse = useCopyHttpResponse(response);
  const filterLeftSlot = useCallback(
    (filter: TextFilterApi) => (
      <div className="py-0.5 flex">
        <RecentFiltersDropdown
          recentFilters={recentFilters}
          activeFilter={filter.appliedFilter}
          onSelect={filter.replaceFilter}
          onRemove={removeFilter}
          onTogglePin={togglePin}
          onClear={clearFilters}
        />
      </div>
    ),
    [recentFilters, removeFilter, togglePin, clearFilters],
  );

  if (response == null) return undefined;
  const actionsDisabled = response.state !== "closed" && response.status >= 100;
  return {
    filterStateKey,
    onFilterApplied: addFilter,
    filterLeftSlot,
    footerActions: [
      <IconButton
        key="save"
        size="sm"
        icon="save"
        title="Save response to file"
        disabled={actionsDisabled}
        onClick={() => saveResponse.mutate()}
        className="border !border-border-subtle"
      />,
      <IconButton
        key="copy"
        size="sm"
        icon="copy"
        title="Copy response body"
        disabled={actionsDisabled}
        onClick={() => copyResponse.mutate()}
        className="border !border-border-subtle"
      />,
    ],
  };
}

function renderCopyButton(getText: () => Promise<string | null>) {
  return <CopyButton color="secondary" variant="border" size="xs" text={getText} />;
}

function getRedirectDropWarning(
  events: HttpResponseEvent[] | undefined,
): RedirectDropWarning | null {
  if (events == null || events.length === 0) return null;

  let droppedBodyCount = 0;
  const droppedHeaders = new Set<string>();
  for (const e of events) {
    const event = e.event;
    if (event.type !== "redirect") {
      continue;
    }

    if (event.dropped_body) {
      droppedBodyCount += 1;
    }
    for (const headerName of event.dropped_headers ?? []) {
      pushHeaderName(droppedHeaders, headerName);
    }
  }

  if (droppedBodyCount === 0 && droppedHeaders.size === 0) {
    return null;
  }

  return {
    droppedBodyCount,
    droppedHeaders: Array.from(droppedHeaders).sort(),
  };
}

function pushHeaderName(headers: Set<string>, headerName: string): void {
  const existing = Array.from(headers).find((h) => h.toLowerCase() === headerName.toLowerCase());
  if (existing == null) {
    headers.add(headerName);
  }
}

function getRedirectWarningLabel(warning: RedirectDropWarning): string {
  if (warning.droppedBodyCount > 0 && warning.droppedHeaders.length > 0) {
    return "Dropped body and headers";
  }
  if (warning.droppedBodyCount > 0) {
    return "Dropped body";
  }
  return "Dropped headers";
}
