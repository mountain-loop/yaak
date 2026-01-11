import type {
  HttpResponse,
  HttpResponseEvent,
  HttpResponseEventData,
} from '@yaakapp-internal/models';
import { type ReactNode, useState } from 'react';
import { useHttpResponseEvents } from '../hooks/useHttpResponseEvents';
import { Editor } from './core/Editor/LazyEditor';
import { EventDetailHeader, EventViewer, type EventDetailAction } from './core/EventViewer';
import { EventViewerRow } from './core/EventViewerRow';
import { HttpMethodTagRaw } from './core/HttpMethodTag';
import { HttpStatusTagRaw } from './core/HttpStatusTag';
import { Icon, type IconProps } from './core/Icon';
import { KeyValueRow, KeyValueRows } from './core/KeyValueRow';

interface Props {
  response: HttpResponse;
}

export function HttpResponseTimeline({ response }: Props) {
  return <Inner key={response.id} response={response} />;
}

function Inner({ response }: Props) {
  const [showRaw, setShowRaw] = useState(false);
  const { data: events, error, isLoading } = useHttpResponseEvents(response);

  return (
    <EventViewer
      events={events ?? []}
      getEventKey={(event) => event.id}
      error={error ? String(error) : null}
      isLoading={isLoading}
      loadingMessage="Loading events..."
      emptyMessage="No events recorded"
      splitLayoutName="http_response_events"
      defaultRatio={0.25}
      renderRow={({ event, isActive, onClick }) => {
        const display = getEventDisplay(event.event);
        return (
          <EventViewerRow
            isActive={isActive}
            onClick={onClick}
            icon={<Icon color={display.color} icon={display.icon} size="sm" />}
            content={display.summary}
            timestamp={event.createdAt}
          />
        );
      }}
      renderDetail={({ event }) => (
        <EventDetails event={event} showRaw={showRaw} setShowRaw={setShowRaw} />
      )}
    />
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function EventDetails({
  event,
  showRaw,
  setShowRaw,
}: {
  event: HttpResponseEvent;
  showRaw: boolean;
  setShowRaw: (v: boolean) => void;
}) {
  const { label } = getEventDisplay(event.event);
  const e = event.event;

  const actions: EventDetailAction[] = [
    {
      key: 'toggle-raw',
      label: showRaw ? 'Formatted' : 'Text',
      onClick: () => setShowRaw(!showRaw),
    },
  ];

  // Determine the title based on event type
  const title =
    e.type === 'header_up'
      ? 'Header Sent'
      : e.type === 'header_down'
        ? 'Header Received'
        : label;

  // Raw view - show plaintext representation
  if (showRaw) {
    const rawText = formatEventRaw(event.event);
    return (
      <div className="flex flex-col gap-2 h-full">
        <EventDetailHeader title={title} timestamp={event.createdAt} actions={actions} />
        <Editor language="text" defaultValue={rawText} readOnly stateKey={null} />
      </div>
    );
  }

  // Headers - show name and value with Editor for JSON
  if (e.type === 'header_up' || e.type === 'header_down') {
    return (
      <div className="flex flex-col gap-2 h-full">
        <EventDetailHeader title={title} timestamp={event.createdAt} actions={actions} />
        <KeyValueRows>
          <KeyValueRow label="Header">{e.name}</KeyValueRow>
          <KeyValueRow label="Value">{e.value}</KeyValueRow>
        </KeyValueRows>
      </div>
    );
  }

  // Request URL - show method and path separately
  if (e.type === 'send_url') {
    return (
      <div className="flex flex-col gap-2">
        <EventDetailHeader title="Request" timestamp={event.createdAt} actions={actions} />
        <KeyValueRows>
          <KeyValueRow label="Method">
            <HttpMethodTagRaw forceColor method={e.method} />
          </KeyValueRow>
          <KeyValueRow label="Path">{e.path}</KeyValueRow>
        </KeyValueRows>
      </div>
    );
  }

  // Response status - show version and status separately
  if (e.type === 'receive_url') {
    return (
      <div className="flex flex-col gap-2">
        <EventDetailHeader title="Response" timestamp={event.createdAt} actions={actions} />
        <KeyValueRows>
          <KeyValueRow label="HTTP Version">{e.version}</KeyValueRow>
          <KeyValueRow label="Status">
            <HttpStatusTagRaw status={e.status} />
          </KeyValueRow>
        </KeyValueRows>
      </div>
    );
  }

  // Redirect - show status, URL, and behavior
  if (e.type === 'redirect') {
    return (
      <div className="flex flex-col gap-2">
        <EventDetailHeader title="Redirect" timestamp={event.createdAt} actions={actions} />
        <KeyValueRows>
          <KeyValueRow label="Status">
            <HttpStatusTagRaw status={e.status} />
          </KeyValueRow>
          <KeyValueRow label="Location">{e.url}</KeyValueRow>
          <KeyValueRow label="Behavior">
            {e.behavior === 'drop_body' ? 'Drop body, change to GET' : 'Preserve method and body'}
          </KeyValueRow>
        </KeyValueRows>
      </div>
    );
  }

  // Settings - show as key/value
  if (e.type === 'setting') {
    return (
      <div className="flex flex-col gap-2">
        <EventDetailHeader title="Apply Setting" timestamp={event.createdAt} actions={actions} />
        <KeyValueRows>
          <KeyValueRow label="Setting">{e.name}</KeyValueRow>
          <KeyValueRow label="Value">{e.value}</KeyValueRow>
        </KeyValueRows>
      </div>
    );
  }

  // Chunks - show formatted bytes
  if (e.type === 'chunk_sent' || e.type === 'chunk_received') {
    const direction = e.type === 'chunk_sent' ? 'Sent' : 'Received';
    return (
      <div className="flex flex-col gap-2">
        <EventDetailHeader
          title={`Data ${direction}`}
          timestamp={event.createdAt}
          actions={actions}
        />
        <div className="font-mono text-editor">{formatBytes(e.bytes)}</div>
      </div>
    );
  }

  // Default - use summary
  const { summary } = getEventDisplay(event.event);
  return (
    <div className="flex flex-col gap-1">
      <EventDetailHeader title={label} timestamp={event.createdAt} actions={actions} />
      <div className="font-mono text-editor">{summary}</div>
    </div>
  );
}

/** Format event as raw plaintext for debugging */
function formatEventRaw(event: HttpResponseEventData): string {
  switch (event.type) {
    case 'send_url':
      return `${event.method} ${event.path}`;
    case 'receive_url':
      return `${event.version} ${event.status}`;
    case 'header_up':
      return `${event.name}: ${event.value}`;
    case 'header_down':
      return `${event.name}: ${event.value}`;
    case 'redirect':
      return `${event.status} Redirect: ${event.url}`;
    case 'setting':
      return `${event.name} = ${event.value}`;
    case 'info':
      return `${event.message}`;
    case 'chunk_sent':
      return `[${formatBytes(event.bytes)} sent]`;
    case 'chunk_received':
      return `[${formatBytes(event.bytes)} received]`;
    default:
      return '[unknown event]';
  }
}

type EventDisplay = {
  icon: IconProps['icon'];
  color: IconProps['color'];
  label: string;
  summary: ReactNode;
};

function getEventDisplay(event: HttpResponseEventData): EventDisplay {
  switch (event.type) {
    case 'setting':
      return {
        icon: 'settings',
        color: 'secondary',
        label: 'Setting',
        summary: `${event.name} = ${event.value}`,
      };
    case 'info':
      return {
        icon: 'info',
        color: 'secondary',
        label: 'Info',
        summary: event.message,
      };
    case 'redirect':
      return {
        icon: 'arrow_big_right_dash',
        color: 'warning',
        label: 'Redirect',
        summary: `Redirecting ${event.status} ${event.url}${event.behavior === 'drop_body' ? ' (drop body)' : ''}`,
      };
    case 'send_url':
      return {
        icon: 'arrow_big_up_dash',
        color: 'primary',
        label: 'Request',
        summary: `${event.method} ${event.path}`,
      };
    case 'receive_url':
      return {
        icon: 'arrow_big_down_dash',
        color: 'info',
        label: 'Response',
        summary: `${event.version} ${event.status}`,
      };
    case 'header_up':
      return {
        icon: 'arrow_big_up_dash',
        color: 'primary',
        label: 'Header',
        summary: `${event.name}: ${event.value}`,
      };
    case 'header_down':
      return {
        icon: 'arrow_big_down_dash',
        color: 'info',
        label: 'Header',
        summary: `${event.name}: ${event.value}`,
      };

    case 'chunk_sent':
      return {
        icon: 'info',
        color: 'secondary',
        label: 'Chunk',
        summary: `${formatBytes(event.bytes)} chunk sent`,
      };
    case 'chunk_received':
      return {
        icon: 'info',
        color: 'secondary',
        label: 'Chunk',
        summary: `${formatBytes(event.bytes)} chunk received`,
      };
    default:
      return {
        icon: 'info',
        color: 'secondary',
        label: 'Unknown',
        summary: 'Unknown event',
      };
  }
}
