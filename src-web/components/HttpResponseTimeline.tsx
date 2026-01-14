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
      renderDetail={({ event, onClose }) => (
        <EventDetails event={event} showRaw={showRaw} setShowRaw={setShowRaw} onClose={onClose} />
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
  onClose,
}: {
  event: HttpResponseEvent;
  showRaw: boolean;
  setShowRaw: (v: boolean) => void;
  onClose: () => void;
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
  const title = (() => {
    switch (e.type) {
      case 'header_up':
        return 'Header Sent';
      case 'header_down':
        return 'Header Received';
      case 'send_url':
        return 'Request';
      case 'receive_url':
        return 'Response';
      case 'redirect':
        return 'Redirect';
      case 'setting':
        return 'Apply Setting';
      case 'chunk_sent':
        return 'Data Sent';
      case 'chunk_received':
        return 'Data Received';
      case 'dns_resolved':
        return e.overridden ? 'DNS Override' : 'DNS Resolution';
      default:
        return label;
    }
  })();

  // Render content based on view mode and event type
  const renderContent = () => {
    // Raw view - show plaintext representation
    if (showRaw) {
      const rawText = formatEventRaw(event.event);
      return <Editor language="text" defaultValue={rawText} readOnly stateKey={null} />;
    }

    // Headers - show name and value
    if (e.type === 'header_up' || e.type === 'header_down') {
      return (
        <KeyValueRows>
          <KeyValueRow label="Header">{e.name}</KeyValueRow>
          <KeyValueRow label="Value">{e.value}</KeyValueRow>
        </KeyValueRows>
      );
    }

    // Request URL - show method and path separately
    if (e.type === 'send_url') {
      return (
        <KeyValueRows>
          <KeyValueRow label="Method">
            <HttpMethodTagRaw forceColor method={e.method} />
          </KeyValueRow>
          <KeyValueRow label="Path">{e.path}</KeyValueRow>
        </KeyValueRows>
      );
    }

    // Response status - show version and status separately
    if (e.type === 'receive_url') {
      return (
        <KeyValueRows>
          <KeyValueRow label="HTTP Version">{e.version}</KeyValueRow>
          <KeyValueRow label="Status">
            <HttpStatusTagRaw status={e.status} />
          </KeyValueRow>
        </KeyValueRows>
      );
    }

    // Redirect - show status, URL, and behavior
    if (e.type === 'redirect') {
      return (
        <KeyValueRows>
          <KeyValueRow label="Status">
            <HttpStatusTagRaw status={e.status} />
          </KeyValueRow>
          <KeyValueRow label="Location">{e.url}</KeyValueRow>
          <KeyValueRow label="Behavior">
            {e.behavior === 'drop_body' ? 'Drop body, change to GET' : 'Preserve method and body'}
          </KeyValueRow>
        </KeyValueRows>
      );
    }

    // Settings - show as key/value
    if (e.type === 'setting') {
      return (
        <KeyValueRows>
          <KeyValueRow label="Setting">{e.name}</KeyValueRow>
          <KeyValueRow label="Value">{e.value}</KeyValueRow>
        </KeyValueRows>
      );
    }

    // Chunks - show formatted bytes
    if (e.type === 'chunk_sent' || e.type === 'chunk_received') {
      return <div className="font-mono text-editor">{formatBytes(e.bytes)}</div>;
    }

    // DNS Resolution - show hostname, addresses, and timing
    if (e.type === 'dns_resolved') {
      return (
        <KeyValueRows>
          <KeyValueRow label="Hostname">{e.hostname}</KeyValueRow>
          <KeyValueRow label="Addresses">{e.addresses.join(', ')}</KeyValueRow>
          <KeyValueRow label="Duration">
            {e.overridden ? (
              <span className="text-text-subtlest">--</span>
            ) : (
              `${String(e.duration)}ms`
            )}
          </KeyValueRow>
          {e.overridden ? <KeyValueRow label="Source">Workspace Override</KeyValueRow> : null}
        </KeyValueRows>
      );
    }

    // Default - use summary
    const { summary } = getEventDisplay(event.event);
    return <div className="font-mono text-editor">{summary}</div>;
  };
  return (
    <div className="flex flex-col gap-2 h-full">
      <EventDetailHeader title={title} timestamp={event.createdAt} actions={actions} onClose={onClose} />
      {renderContent()}
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
    case 'dns_resolved':
      if (event.overridden) {
        return `DNS override ${event.hostname} → ${event.addresses.join(', ')}`;
      }
      return `DNS resolved ${event.hostname} → ${event.addresses.join(', ')} (${event.duration}ms)`;
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
        color: 'success',
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
    case 'dns_resolved':
      return {
        icon: 'globe',
        color: event.overridden ? 'success' : 'secondary',
        label: event.overridden ? 'DNS Override' : 'DNS',
        summary: event.overridden
          ? `${event.hostname} → ${event.addresses.join(', ')} (overridden)`
          : `${event.hostname} → ${event.addresses.join(', ')} (${event.duration}ms)`,
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
