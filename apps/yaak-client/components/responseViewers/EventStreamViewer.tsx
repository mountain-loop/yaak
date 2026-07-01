import type { HttpResponse } from "@yaakapp-internal/models";
import { extractSseValueAtPath, type ServerSentEvent } from "@yaakapp-internal/sse";
import { HStack, Icon, InlineCode, SplitLayout, VStack } from "@yaakapp-internal/ui";
import classNames from "classnames";
import type { CSSProperties, ReactNode } from "react";
import { Fragment, useMemo, useState } from "react";
import { useKeyValue } from "../../hooks/useKeyValue";
import { useFormatText } from "../../hooks/useFormatText";
import { useResponseBodyEventSource } from "../../hooks/useResponseBodyEventSource";
import { useResponseBodySseSummary } from "../../hooks/useResponseBodySseSummary";
import {
  sseSummaryResultKeyPathAutocomplete,
  useSseSummaryResultKeyPath,
} from "../../hooks/useSseSummaryResultKeyPath";
import { isJSON } from "../../lib/contentType";
import { EmptyStateText } from "../EmptyStateText";
import { Markdown } from "../Markdown";
import { Button } from "../core/Button";
import type { DropdownItem } from "../core/Dropdown";
import { Dropdown } from "../core/Dropdown";
import type { EditorProps } from "../core/Editor/Editor";
import { Editor } from "../core/Editor/LazyEditor";
import { EventDetailHeader, EventViewer } from "../core/EventViewer";
import { EventViewerRow } from "../core/EventViewerRow";
import { IconButton } from "../core/IconButton";
import { IconTooltip } from "../core/IconTooltip";
import { Input } from "../core/Input";
import { Select } from "../core/Select";

interface Props {
  response: HttpResponse;
}

const DEFAULT_EXTRACTED_TEXT_RATIO = 0.28;

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
  const filterEventPreviewsSetting = useKeyValue<boolean>({
    namespace: "no_sync",
    key: ["sse_filter_event_previews", response.requestId],
    fallback: false,
  });
  const applyToDetailsSetting = useKeyValue<boolean>({
    namespace: "no_sync",
    key: ["sse_apply_to_details", response.requestId],
    fallback: false,
  });
  const renderMarkdownSetting = useKeyValue<boolean>({
    namespace: "no_sync",
    key: ["sse_render_markdown", response.requestId],
    fallback: false,
  });
  const summarySettings = useSseSummaryResultKeyPath({ response });
  const events = useResponseBodyEventSource(response);
  const summary = useResponseBodySseSummary(response, summarySettings.resultKeyPath);
  const showExtractedText = summarySettings.resultKeyPath != null;
  const showResultKeyPathWarning =
    showExtractedText &&
    summary.data != null &&
    summary.data.fragmentCount === 0 &&
    !summary.isFetching &&
    summary.error == null;
  const filterEventPreviews = showExtractedText && filterEventPreviewsSetting.value === true;
  const applyToDetails = showExtractedText && applyToDetailsSetting.value === true;
  const renderMarkdown = showExtractedText && renderMarkdownSetting.value === true;
  const settingsItems = useMemo<DropdownItem[]>(
    () => [
      {
        label: "Apply to Previews",
        keepOpenOnSelect: true,
        onSelect: () => filterEventPreviewsSetting.set(filterEventPreviewsSetting.value !== true),
        leftSlot: (
          <Icon
            icon={
              filterEventPreviewsSetting.value === true
                ? "check_square_checked"
                : "check_square_unchecked"
            }
          />
        ),
      },
      {
        label: "Apply to Details",
        keepOpenOnSelect: true,
        onSelect: () => applyToDetailsSetting.set(applyToDetailsSetting.value !== true),
        leftSlot: (
          <Icon
            icon={
              applyToDetailsSetting.value === true
                ? "check_square_checked"
                : "check_square_unchecked"
            }
          />
        ),
      },
    ],
    [
      applyToDetailsSetting,
      filterEventPreviewsSetting,
    ],
  );

  return (
    <div className="h-full min-h-0 grid grid-rows-[auto_minmax(0,1fr)]">
      <HStack space={2} alignItems="center" className="pt-1 pb-1 border-b border-border-subtle">
        <div className={classNames(summarySettings.enabled ? "w-44 shrink-0" : "min-w-40 flex-1")}>
          <Select
            name={`sse-summary-result-key-path-enabled::${response.requestId}`}
            label="Extracted text"
            hideLabel
            size="xs"
            value={summarySettings.enabled ? "jsonpath" : "off"}
            options={[
              { label: "Full events", value: "off" },
              { label: "JSONPath", value: "jsonpath" },
            ]}
            onChange={(value) => summarySettings.setEnabled(value === "jsonpath")}
          />
        </div>
        {summarySettings.enabled && (
          <>
            <div className="min-w-40 flex-1">
              <Input
                label="Result JSON path"
                hideLabel
                size="xs"
                autocomplete={sseSummaryResultKeyPathAutocomplete}
                defaultValue={summarySettings.resultKeyPathInputValue}
                forceUpdateKey={`${response.requestId}:${summarySettings.inferredResultKeyPath ?? ""}`}
                placeholder="$.choices[0].delta.content"
                rightSlot={
                  showResultKeyPathWarning ? (
                    <div className="flex items-center px-2">
                      <IconTooltip
                        tabIndex={-1}
                        icon="alert_triangle"
                        iconColor="notice"
                        content="No text fragments matched this JSONPath."
                      />
                    </div>
                  ) : null
                }
                stateKey={`sse-summary-result-key-path::${response.requestId}`}
                tint={showResultKeyPathWarning ? "notice" : undefined}
                onChange={summarySettings.setResultKeyPath}
              />
            </div>
            <Dropdown items={settingsItems}>
              <IconButton
                size="xs"
                variant="border"
                icon="settings"
                title="Extracted text settings"
              />
            </Dropdown>
          </>
        )}
      </HStack>
      <SplitLayout
        layout="vertical"
        storageKey={`sse_extracted_text::${response.requestId}`}
        defaultRatio={DEFAULT_EXTRACTED_TEXT_RATIO}
        minHeightPx={72}
        resizeHandleClassName="hover:bg-surface-highlight active:bg-surface-highlight"
        firstSlot={({ style }) => (
          <div style={style} className="min-h-0">
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
                      <span className="truncate text-xs">
                        {getEventPreview(event, summarySettings.resultKeyPath, filterEventPreviews)}
                      </span>
                    </HStack>
                  }
                />
              )}
              renderDetail={({ event, index, onClose }) => (
                <EventDetail
                  event={event}
                  index={index}
                  applyJsonPath={applyToDetails}
                  resultKeyPath={summarySettings.resultKeyPath}
                  showLarge={showLarge}
                  showingLarge={showingLarge}
                  setShowLarge={setShowLarge}
                  setShowingLarge={setShowingLarge}
                  onClose={onClose}
                />
              )}
            />
          </div>
        )}
        secondSlot={
          showExtractedText
            ? ({ style }) => (
                <SseSummaryFooter
                  style={style}
                  error={summary.error ? String(summary.error) : null}
                  isLoading={summary.isLoading}
                  onRenderMarkdownChange={renderMarkdownSetting.set}
                  renderMarkdown={renderMarkdown}
                  resultKeyPath={summarySettings.resultKeyPath ?? ""}
                  summary={summary.data?.summary ?? ""}
                  fragmentCount={summary.data?.fragmentCount ?? 0}
                />
              )
            : null
        }
      />
    </div>
  );
}

function SseSummaryFooter({
  error,
  fragmentCount,
  isLoading,
  onRenderMarkdownChange,
  renderMarkdown,
  resultKeyPath,
  style,
  summary,
}: {
  error: string | null;
  fragmentCount: number;
  isLoading: boolean;
  onRenderMarkdownChange: (renderMarkdown: boolean) => void;
  renderMarkdown: boolean;
  resultKeyPath: string;
  style: CSSProperties;
  summary: string;
}) {
  const hasSummary = fragmentCount > 0;
  const actions = useMemo(
    () => [
      {
        key: "sse-summary-format",
        label: "Extracted text format",
        type: "select" as const,
        value: renderMarkdown ? "markdown" : "text",
        options: [
          { label: "Text", value: "text" },
          { label: "Markdown", value: "markdown" },
        ],
        onChange: (value: string) => onRenderMarkdownChange(value === "markdown"),
      },
    ],
    [onRenderMarkdownChange, renderMarkdown],
  );

  return (
    <div
      style={style}
      className="min-h-0 overflow-hidden border-t border-border-subtle bg-surface grid grid-rows-[auto_minmax(0,1fr)]"
    >
      <div className="pt-2">
        <EventDetailHeader
          actions={actions}
          title="Extracted Text"
          copyText={hasSummary ? summary : undefined}
        />
      </div>
      <div
        className={classNames(
          "min-h-0 py-2 overflow-auto",
          (error != null || isLoading || (hasSummary && !renderMarkdown)) && "text-xs",
        )}
      >
        {error != null ? (
          <span className="text-danger">{error}</span>
        ) : isLoading ? (
          <span className="italic text-text-subtlest">Loading extracted text...</span>
        ) : hasSummary ? (
          renderMarkdown ? (
            <div className="min-h-0">
              <Markdown className="select-auto cursor-auto">{summary}</Markdown>
            </div>
          ) : (
            <pre className="font-mono whitespace-pre-wrap break-words select-auto cursor-auto">
              {summary}
            </pre>
          )
        ) : (
          <EmptyStateText className="gap-1.5">
            No fragments for <InlineCode className="py-0">{resultKeyPath}</InlineCode>
          </EmptyStateText>
        )}
      </div>
    </div>
  );
}

function getEventPreview(
  event: ServerSentEvent,
  resultKeyPath: string | null,
  filterEventPreview: boolean,
): string {
  if (filterEventPreview && resultKeyPath != null) {
    return (extractSseValueAtPath(event.data, resultKeyPath) ?? event.data).slice(0, 1000);
  }

  return event.data.slice(0, 1000);
}

function EventDetail({
  applyJsonPath,
  event,
  index,
  resultKeyPath,
  showLarge,
  showingLarge,
  setShowLarge,
  setShowingLarge,
  onClose,
}: {
  applyJsonPath: boolean;
  event: ServerSentEvent;
  index: number;
  resultKeyPath: string | null;
  showLarge: boolean;
  showingLarge: boolean;
  setShowLarge: (v: boolean) => void;
  setShowingLarge: (v: boolean) => void;
  onClose: () => void;
}) {
  const detailText = useMemo(
    () =>
      applyJsonPath && resultKeyPath != null
        ? (extractSseValueAtPath(event.data, resultKeyPath) ?? event.data)
        : event.data,
    [applyJsonPath, event.data, resultKeyPath],
  );
  const language = useMemo<"text" | "json">(() => {
    if (!detailText) return "text";
    return isJSON(detailText) ? "json" : "text";
  }, [detailText]);

  return (
    <div className="flex flex-col h-full">
      <EventDetailHeader
        title="Message Received"
        prefix={<EventLabels event={event} index={index} />}
        onClose={onClose}
      />
      {!showLarge && detailText.length > 1000 * 1000 ? (
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
        <FormattedEditor language={language} text={detailText} />
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
      <EventLabel isActive={isActive}>{event.id ?? index}</EventLabel>
      {event.eventType && <EventLabel isActive={isActive}>{event.eventType}</EventLabel>}
    </HStack>
  );
}

function EventLabel({ children, isActive }: { children: ReactNode; isActive?: boolean }) {
  return (
    <InlineCode className={classNames("py-0", isActive && "relative overflow-hidden")}>
      {isActive && <span className="absolute inset-0 bg-text opacity-5 pointer-events-none" />}
      <span className="relative">{children}</span>
    </InlineCode>
  );
}
