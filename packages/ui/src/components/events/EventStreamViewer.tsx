import classNames from "classnames";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { formatSize } from "@yaakapp-internal/lib/formatSize";
import { Banner } from "../Banner";
import { Button } from "../Button";
import { useEditorHost } from "../EditorHost";
import { EmptyStateText } from "../EmptyStateText";
import { Icon } from "../Icon";
import { InlineCode } from "../InlineCode";
import { HStack, VStack } from "../Stacks";
import { HexdumpViewer } from "../viewers/HexdumpViewer";
import { type EventDetailAction, EventDetailHeader, EventViewer } from "./EventViewer";
import { EventViewerRow } from "./EventViewerRow";
import {
  eventDeltas,
  formatEventDelta,
  formatEventTime,
  type StreamEvent,
  type StreamPayload,
  type StreamPayloadText,
  type StreamPayloadView,
} from "./streamEvents";

/** Which columns the list draws beside each event's preview */
export interface EventStreamColumns {
  /** The direction arrow, for a stream that goes both ways */
  direction?: boolean;
  /** The kind column's heading, like `Type` or `Event`; no column when not given */
  kind?: string;
  /** The kind column's width, as CSS: rows are laid out one by one, so it can't fit its content */
  kindWidth?: string;
  size?: boolean;
  /** The time each passed, and how long after the one before */
  time?: boolean;
  /** The preview column's heading */
  preview?: string;
}

export interface EventStreamViewerProps {
  events: StreamEvent[];
  /** Where the list and detail split is remembered */
  splitLayoutStorageKey: string;
  defaultRatio?: number;
  /** Above the list, as a connection's status */
  header?: ReactNode;
  error?: string | null;
  isLoading?: boolean;
  emptyMessage?: string;
  /** Without columns, a row is the client's: its arrow, its labels and its preview */
  columns?: EventStreamColumns;
  /** The text a row previews, when it isn't the event's own `preview` */
  getPreview?: (event: StreamEvent) => string | null;
  /** Reads an event's whole payload, for the default detail */
  loadPayload?: (event: StreamEvent) => Promise<StreamPayload>;
  /** Ways to show an event's payload beyond its text and hexdump, as a gRPC message's decodes */
  payloadViews?: (event: StreamEvent) => StreamPayloadView[] | null;
  /** Replaces the default detail, which shows the payload `loadPayload` reads */
  renderDetail?: (props: { event: StreamEvent; index: number; onClose: () => void }) => ReactNode;
  /** Holds and catches up, as the proxy's flow list does, while more events arrive */
  catchUp?: { label: (count: number) => string };
}

/** A stream's events as a list, with the selected one's payload below */
export function EventStreamViewer({
  events,
  splitLayoutStorageKey,
  defaultRatio = 0.4,
  header,
  error,
  isLoading,
  emptyMessage,
  columns,
  getPreview,
  loadPayload,
  payloadViews,
  renderDetail,
  catchUp,
}: EventStreamViewerProps) {
  const deltas = useMemo(() => (columns?.time ? eventDeltas(events) : null), [columns, events]);
  return (
    <EventViewer
      events={events}
      getEventKey={(event) => event.key}
      error={error}
      isLoading={isLoading}
      emptyMessage={emptyMessage}
      splitLayoutStorageKey={splitLayoutStorageKey}
      defaultRatio={defaultRatio}
      catchUp={catchUp}
      header={
        columns == null ? (
          header
        ) : (
          <div>
            {header}
            <ColumnHeadings columns={columns} />
          </div>
        )
      }
      renderRow={({ event, index, isActive, onClick }) => (
        <StreamEventRow
          event={event}
          preview={getPreview ? getPreview(event) : event.preview}
          delta={deltas?.[index] ?? null}
          columns={columns}
          isActive={isActive}
          onClick={onClick}
        />
      )}
      renderDetail={
        renderDetail ??
        (({ event, onClose }) => (
          <StreamEventDetail
            event={event}
            loadPayload={loadPayload}
            views={payloadViews?.(event) ?? null}
            onClose={onClose}
          />
        ))
      }
    />
  );
}

/** One event's row: the client's arrow, labels and preview, or the columns asked for */
export function StreamEventRow({
  event,
  preview,
  delta,
  columns,
  isActive,
  onClick,
}: {
  event: StreamEvent;
  preview: string | null;
  /** Milliseconds since the event before, for the time columns */
  delta: number | null;
  columns?: EventStreamColumns;
  isActive: boolean;
  onClick: () => void;
}) {
  const template = columns == null ? null : gridTemplate(columns);
  if (columns == null || template == null) {
    return (
      <EventViewerRow
        isActive={isActive}
        onClick={onClick}
        icon={<DirectionIcon event={event} />}
        content={
          <HStack space={2} className="items-center">
            {event.labels != null && event.labels.length > 0 && (
              <HStack space={1.5} alignItems="center">
                {event.labels.map((label, i) => (
                  // oxlint-disable-next-line no-array-index-key -- labels may repeat
                  <EventLabel key={`${i}:${label}`} isActive={isActive}>
                    {label}
                  </EventLabel>
                ))}
              </HStack>
            )}
            <span className="truncate text-xs">{preview}</span>
          </HStack>
        }
      />
    );
  }
  const trailing: ReactNode[] = [];
  if (columns.size) {
    trailing.push(
      <span className="text-text-subtlest">
        {event.size == null ? "" : formatSize(event.size)}
      </span>,
    );
  }
  if (columns.time) {
    trailing.push(
      <span className="text-text-subtlest">{formatEventDelta(delta)}</span>,
      <span className="opacity-70">{formatEventTime(event.timestamp)}</span>,
    );
  }
  return (
    <EventViewerRow
      isActive={isActive}
      onClick={onClick}
      columns={template}
      icon={columns.direction ? <DirectionIcon event={event} /> : null}
      cells={{
        kind:
          columns.kind == null ? undefined : (
            <span className={classNames(event.warning && "text-warning")}>{event.kind}</span>
          ),
        trailing,
      }}
      content={<RowPreview event={event} preview={preview} />}
    />
  );
}

function gridTemplate(columns: EventStreamColumns): string {
  return [
    columns.direction ? "1rem" : null,
    columns.kind == null ? null : (columns.kindWidth ?? "4rem"),
    "minmax(0,1fr)",
    columns.size ? "4.5rem" : null,
    columns.time ? "4.5rem 6.5rem" : null,
  ]
    .filter((c) => c != null)
    .join(" ");
}

function ColumnHeadings({ columns }: { columns: EventStreamColumns }) {
  const template = gridTemplate(columns);
  return (
    <div className="px-1">
      <div
        style={{ gridTemplateColumns: template }}
        className="grid gap-2 items-center px-1.5 h-xs text-xs text-text-subtlest border-b border-surface-highlight mb-1"
      >
        {columns.direction && <span />}
        {columns.kind != null && <span>{columns.kind}</span>}
        <span>{columns.preview ?? "Message"}</span>
        {columns.size && <span className="text-right">Size</span>}
        {columns.time && (
          <>
            <span className="text-right" title="Since the message before">
              Delta
            </span>
            <span className="text-right">Time</span>
          </>
        )}
      </div>
    </div>
  );
}

function RowPreview({ event, preview }: { event: StreamEvent; preview: string | null }) {
  if (event.note != null) {
    return (
      <span className={classNames("text-xs", event.warning ? "text-warning" : "text-text-subtle")}>
        {event.note}
      </span>
    );
  }
  if (preview != null && preview !== "") {
    return <span className="text-xs">{preview.slice(0, 1000)}</span>;
  }
  if (event.binary && (event.size ?? 0) > 0) {
    return <em className="italic text-text-subtlest">Binary</em>;
  }
  return <em className="italic text-text-subtlest">No content</em>;
}

function DirectionIcon({ event }: { event: StreamEvent }) {
  if (event.direction === "info") {
    return event.warning ? (
      <Icon color="warning" icon="alert_triangle" />
    ) : (
      <Icon color="secondary" icon="info" />
    );
  }
  return event.direction === "sent" ? (
    <Icon color="primary" title="Client Message" icon="arrow_big_up_dash" />
  ) : (
    <Icon color="info" title="Server Message" icon="arrow_big_down_dash" />
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

const LARGE_PAYLOAD = 1000 * 1000;

/** A payload too large to show until asked to: over 1 MB, and not yet asked */
export function isLargePayload(size: number, showLarge: boolean): boolean {
  return !showLarge && size > LARGE_PAYLOAD;
}

/**
 * Whether a payload's text view may load: decoding, parsing and pretty-printing it. Only once its
 * bytes are in, so its size is known (a compressed gRPC message's is not until then), and not
 * while it is too large to show.
 */
export function shouldLoadText({
  hasBytes,
  tooLarge,
}: {
  hasBytes: boolean;
  tooLarge: boolean;
}): boolean {
  return hasBytes && !tooLarge;
}

/** The text and hexdump views every payload has */
function defaultViews(bytes: Uint8Array | null): StreamPayloadView[] {
  return [
    {
      value: "message",
      label: "Message",
      type: "text",
      load: async () => payloadText(bytes ?? new Uint8Array()),
    },
    { value: "hexdump", label: "Hexdump", type: "hexdump" },
  ];
}

/** A payload's text, highlighted and pretty-printed as JSON when it is JSON */
export function payloadText(bytes: Uint8Array): StreamPayloadText {
  const text = new TextDecoder("utf-8").decode(bytes);
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed != null && typeof parsed === "object") {
      return { text: JSON.stringify(parsed, null, 2), language: "json" };
    }
  } catch {
    // Not JSON
  }
  return { text, language: "text" };
}

interface Loaded<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

function useLoaded<T>(load: (() => Promise<T>) | null, key: string): Loaded<T> {
  const [state, setState] = useState<Loaded<T> & { key: string }>({
    key: "",
    data: null,
    error: null,
    loading: load != null,
  });
  // oxlint-disable-next-line react-hooks/exhaustive-deps -- reloads by key, not by callback identity
  useEffect(() => {
    if (load == null) return;
    let cancelled = false;
    setState({ key, data: null, error: null, loading: true });
    load().then(
      (data) => !cancelled && setState({ key, data, error: null, loading: false }),
      (e) => !cancelled && setState({ key, data: null, error: String(e), loading: false }),
    );
    return () => {
      cancelled = true;
    };
  }, [key]);
  return state.key === key ? state : { data: null, error: null, loading: load != null };
}

function StreamEventDetail({
  event,
  loadPayload,
  views: extraViews,
  onClose,
}: {
  event: StreamEvent;
  loadPayload?: (event: StreamEvent) => Promise<StreamPayload>;
  views: StreamPayloadView[] | null;
  onClose: () => void;
}) {
  const { Editor } = useEditorHost();
  const payload = useLoaded(loadPayload ? () => loadPayload(event) : null, event.key);
  const bytes = payload.data?.bytes ?? null;
  const views = extraViews ?? defaultViews(bytes);
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const defaultView = event.binary && extraViews == null ? "hexdump" : views[0]?.value;
  const viewValue = chosen[event.key] ?? defaultView ?? "message";
  const view = views.find((v) => v.value === viewValue) ?? views[0];
  const [shownLarge, setShownLarge] = useState<Record<string, boolean>>({});
  const showLarge = shownLarge[event.key] === true;
  const tooLarge = isLargePayload(bytes?.length ?? event.size ?? 0, showLarge);

  const textLoad =
    view?.type === "text" && shouldLoadText({ hasBytes: bytes != null, tooLarge })
      ? view.load
      : null;
  const text = useLoaded(
    textLoad,
    `${event.key}:${view?.value}:${bytes == null ? 0 : 1}:${textLoad == null ? 0 : 1}`,
  );

  const setView = (value: string) => setChosen((c) => ({ ...c, [event.key]: value }));
  const actions: EventDetailAction[] =
    views.length > 2
      ? [
          {
            type: "select",
            key: "payload-view",
            label: "View as",
            value: view?.value ?? "",
            options: views.map((v) => ({ label: v.label, value: v.value })),
            onChange: setView,
          },
        ]
      : (bytes?.length ?? 0) > 0 && views.length === 2
        ? [
            {
              key: "toggle-hexdump",
              label: view?.type === "hexdump" ? "Show Message" : "Show Hexdump",
              onClick: () =>
                setView(
                  (view?.type === "hexdump"
                    ? views.find((v) => v.type === "text")
                    : views.find((v) => v.type === "hexdump")
                  )?.value ?? viewValue,
                ),
            },
          ]
        : [];

  const title = event.title ?? (event.direction === "sent" ? "Message Sent" : "Message Received");
  const copyText =
    view?.type === "hexdump" ? undefined : (text.data?.text ?? undefined) || undefined;

  let body: ReactNode;
  if (payload.error != null) {
    body = <Banner color="danger">{payload.error}</Banner>;
  } else if (payload.loading) {
    body = null;
  } else if (
    (bytes == null || bytes.length === 0) &&
    (extraViews == null || view?.type !== "text")
  ) {
    // An empty payload has nothing to show as text or bytes; a decode of one may (an empty
    // protobuf message is its defaults)
    body = <EmptyStateText>No Content</EmptyStateText>;
  } else if (tooLarge) {
    body = (
      <VStack space={2} className="italic text-text-subtlest">
        Message previews larger than 1MB are hidden
        <div>
          <Button
            onClick={() => setShownLarge((s) => ({ ...s, [event.key]: true }))}
            color="secondary"
            variant="border"
            size="xs"
          >
            Try Showing
          </Button>
        </div>
      </VStack>
    );
  } else if (view?.type === "hexdump" && bytes != null) {
    body = <HexdumpViewer data={bytes} renderEditor={(props) => <Editor {...props} />} />;
  } else if (text.error != null) {
    body = <Banner color="danger">{text.error}</Banner>;
  } else if (text.data != null) {
    body = (
      <div className="h-full grid grid-rows-[auto_minmax(0,1fr)] gap-1">
        {text.data.note ? (
          <div className="text-xs text-text-subtle">{text.data.note}</div>
        ) : (
          <span aria-hidden />
        )}
        <Editor
          key={`${event.key}:${view?.value}`}
          language={text.data.language}
          defaultValue={text.data.text}
          wrapLines={false}
          readOnly
          stateKey={null}
        />
      </div>
    );
  }

  return (
    <div className="h-full grid grid-rows-[auto_auto_minmax(0,1fr)]">
      <EventDetailHeader
        title={title}
        timestamp={event.timestamp ?? undefined}
        actions={actions}
        copyText={copyText}
        onClose={onClose}
      />
      {event.truncated || event.error ? (
        <Banner color={event.error ? "danger" : "notice"} className="mb-2 text-sm">
          {event.error ?? "The message was truncated at the capture limit."}
        </Banner>
      ) : (
        <span aria-hidden />
      )}
      {body}
    </div>
  );
}
