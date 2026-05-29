import type { HttpResponse } from "@yaakapp-internal/models";
import type { ServerSentEvent } from "@yaakapp-internal/sse";
import { HStack, Icon, InlineCode, VStack } from "@yaakapp-internal/ui";
import classNames from "classnames";
import type { PointerEvent as ReactPointerEvent } from "react";
import { Fragment, useCallback, useMemo, useState } from "react";
import { useLocalStorage } from "react-use";
import { useFormatText } from "../../hooks/useFormatText";
import { useResponseBodyEventSource } from "../../hooks/useResponseBodyEventSource";
import { useResponseBodySseSummary } from "../../hooks/useResponseBodySseSummary";
import {
  sseSummaryProviderOptions,
  useSseSummaryResultKeyPath,
} from "../../hooks/useSseSummaryResultKeyPath";
import { isJSON } from "../../lib/contentType";
import { copyToClipboard } from "../../lib/copy";
import { Button } from "../core/Button";
import type { EditorProps } from "../core/Editor/Editor";
import { Editor } from "../core/Editor/LazyEditor";
import { EventDetailHeader, EventViewer } from "../core/EventViewer";
import { EventViewerRow } from "../core/EventViewerRow";
import { PlainInput } from "../core/PlainInput";
import { Select } from "../core/Select";
import { Separator } from "../core/Separator";

interface Props {
  response: HttpResponse;
}

const DEFAULT_SUMMARY_HEIGHT = 160;
const MIN_SUMMARY_HEIGHT = 72;
const MAX_SUMMARY_HEIGHT = 480;

export function EventStreamViewer({ response }: Props) {
  return (
    <Fragment
      key={response.id} // force a refresh when the response changes
    >
      <ActualEventStreamViewer response={response} />
    </Fragment>
  );
}

function ActualEventStreamViewer({ response }: Props) {
  const [showLarge, setShowLarge] = useState<boolean>(false);
  const [showingLarge, setShowingLarge] = useState<boolean>(false);
  const summarySettings = useSseSummaryResultKeyPath({
    requestId: response.requestId,
    workspaceId: response.workspaceId,
  });
  const [summaryHeight, setSummaryHeight] = useLocalStorage<number>(
    `sse_summary_height::${response.requestId}`,
    DEFAULT_SUMMARY_HEIGHT,
  );
  const providerSelectOptions = useMemo(
    () =>
      sseSummaryProviderOptions.map((option) => ({
        label: option.label,
        value: option.value,
      })),
    [],
  );
  const events = useResponseBodyEventSource(response);
  const summary = useResponseBodySseSummary(response, summarySettings.resultKeyPath);
  const isCustomProvider = summarySettings.provider === "custom";

  return (
    <div className="h-full min-h-0 grid grid-rows-[auto_minmax(0,1fr)_auto]">
      <HStack space={2} alignItems="center" className="px-2 py-1 border-b border-border-subtle">
        <div className="w-60 max-w-full shrink-0">
          <Select
            name="sse-summary-provider"
            label="Summary provider"
            hideLabel
            size="xs"
            value={summarySettings.provider}
            options={providerSelectOptions}
            onChange={summarySettings.setProvider}
          />
        </div>
        <div className="min-w-40 flex-1">
          <PlainInput
            label="Result JSON path"
            hideLabel
            size="xs"
            defaultValue={summarySettings.resultKeyPath}
            disabled={!isCustomProvider || summarySettings.isLoading}
            forceUpdateKey={`${response.requestId}:${summarySettings.provider}`}
            placeholder="$.choices[0].delta.content"
            onChange={(keyPath) => {
              if (isCustomProvider) {
                void summarySettings.setCustomResultKeyPath(keyPath);
              }
            }}
          />
        </div>
        <span className="min-w-0 max-w-96 text-xs text-text-subtlest font-mono truncate">
          {summarySettings.resultKeyPath}
        </span>
      </HStack>
      <EventViewer
        events={events.data ?? []}
        getEventKey={(_, index) => String(index)}
        error={events.error ? String(events.error) : null}
        splitLayoutStorageKey="sse_events"
        defaultRatio={0.4}
        renderRow={({ event, index, isActive, onClick }) => (
          <EventViewerRow
            isActive={isActive}
            onClick={onClick}
            icon={<Icon color="info" title="Server Message" icon="arrow_big_down_dash" />}
            content={
              <HStack space={2} className="items-center">
                <EventLabels event={event} index={index} isActive={isActive} />
                <span className="truncate text-xs">{event.data.slice(0, 1000)}</span>
              </HStack>
            }
          />
        )}
        renderDetail={({ event, index, onClose }) => (
          <EventDetail
            event={event}
            index={index}
            showLarge={showLarge}
            showingLarge={showingLarge}
            setShowLarge={setShowLarge}
            setShowingLarge={setShowingLarge}
            onClose={onClose}
          />
        )}
      />
      <SseSummaryFooter
        error={summary.error ? String(summary.error) : null}
        height={summaryHeight ?? DEFAULT_SUMMARY_HEIGHT}
        isLoading={summary.isLoading}
        onHeightChange={setSummaryHeight}
        resultKeyPath={summarySettings.resultKeyPath}
        summary={summary.data?.summary ?? ""}
        fragmentCount={summary.data?.fragmentCount ?? 0}
      />
    </div>
  );
}

function SseSummaryFooter({
  error,
  fragmentCount,
  height,
  isLoading,
  onHeightChange,
  resultKeyPath,
  summary,
}: {
  error: string | null;
  fragmentCount: number;
  height: number;
  isLoading: boolean;
  onHeightChange: (height: number) => void;
  resultKeyPath: string;
  summary: string;
}) {
  const hasSummary = fragmentCount > 0;
  const handleResizeStart = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      const startY = event.clientY;
      const startHeight = height;

      const handlePointerMove = (moveEvent: PointerEvent) => {
        onHeightChange(clampSummaryHeight(startHeight + startY - moveEvent.clientY));
      };

      const handlePointerUp = () => {
        document.removeEventListener("pointermove", handlePointerMove);
        document.removeEventListener("pointerup", handlePointerUp);
      };

      document.addEventListener("pointermove", handlePointerMove);
      document.addEventListener("pointerup", handlePointerUp);
    },
    [height, onHeightChange],
  );

  return (
    <div
      className="min-h-0 border-t border-border-subtle bg-surface grid grid-rows-[auto_auto_minmax(0,1fr)]"
      style={{ height: clampSummaryHeight(height) }}
    >
      <div
        role="separator"
        aria-label="Resize summary"
        aria-orientation="horizontal"
        className="h-1.5 cursor-ns-resize hover:bg-surface-highlight active:bg-surface-highlight"
        onPointerDown={handleResizeStart}
      />
      <HStack space={2} alignItems="center" className="px-2 pt-1">
        <Separator>Summary</Separator>
        <Button
          size="xs"
          variant="border"
          disabled={!hasSummary}
          onClick={() => copyToClipboard(summary)}
        >
          copy
        </Button>
      </HStack>
      <div className="px-3 py-2 overflow-auto text-xs">
        {error != null ? (
          <span className="text-danger">{error}</span>
        ) : isLoading ? (
          <span className="italic text-text-subtlest">Loading summary...</span>
        ) : hasSummary ? (
          <pre className="font-mono whitespace-pre-wrap break-words select-text">{summary}</pre>
        ) : (
          <span className="italic text-text-subtlest">
            No summary fragments found for <InlineCode className="py-0">{resultKeyPath}</InlineCode>
          </span>
        )}
      </div>
    </div>
  );
}

function clampSummaryHeight(height: number): number {
  return Math.max(MIN_SUMMARY_HEIGHT, Math.min(MAX_SUMMARY_HEIGHT, height));
}

function EventDetail({
  event,
  index,
  showLarge,
  showingLarge,
  setShowLarge,
  setShowingLarge,
  onClose,
}: {
  event: ServerSentEvent;
  index: number;
  showLarge: boolean;
  showingLarge: boolean;
  setShowLarge: (v: boolean) => void;
  setShowingLarge: (v: boolean) => void;
  onClose: () => void;
}) {
  const language = useMemo<"text" | "json">(() => {
    if (!event?.data) return "text";
    return isJSON(event?.data) ? "json" : "text";
  }, [event?.data]);

  return (
    <div className="flex flex-col h-full">
      <EventDetailHeader
        title="Message Received"
        prefix={<EventLabels event={event} index={index} />}
        onClose={onClose}
      />
      {!showLarge && event.data.length > 1000 * 1000 ? (
        <VStack space={2} className="italic text-text-subtlest">
          Message previews larger than 1MB are hidden
          <div>
            <Button
              onClick={() => {
                setShowingLarge(true);
                setTimeout(() => {
                  setShowLarge(true);
                  setShowingLarge(false);
                }, 500);
              }}
              isLoading={showingLarge}
              color="secondary"
              variant="border"
              size="xs"
            >
              Try Showing
            </Button>
          </div>
        </VStack>
      ) : (
        <FormattedEditor language={language} text={event.data} />
      )}
    </div>
  );
}

function FormattedEditor({ text, language }: { text: string; language: EditorProps["language"] }) {
  const formatted = useFormatText({ text, language, pretty: true });
  if (formatted == null) return null;
  return <Editor readOnly defaultValue={formatted} language={language} stateKey={null} />;
}

function EventLabels({
  className,
  event,
  index,
  isActive,
}: {
  event: ServerSentEvent;
  index: number;
  className?: string;
  isActive?: boolean;
}) {
  return (
    <HStack space={1.5} alignItems="center" className={className}>
      <InlineCode className={classNames("py-0", isActive && "bg-text-subtlest text-text")}>
        {event.id ?? index}
      </InlineCode>
      {event.eventType && (
        <InlineCode className={classNames("py-0", isActive && "bg-text-subtlest text-text")}>
          {event.eventType}
        </InlineCode>
      )}
    </HStack>
  );
}
