import type {
  HttpResponse,
  HttpResponseEvent,
  HttpResponseEventData,
} from '@yaakapp-internal/models';
import { type ReactNode, useMemo, useState } from 'react';
import { useHttpResponseEvents } from '../hooks/useHttpResponseEvents';
import { Editor } from './core/Editor/LazyEditor';
import { type EventDetailAction, EventDetailHeader, EventViewer } from './core/EventViewer';
import { EventViewerRow } from './core/EventViewerRow';
import { HttpMethodTagRaw } from './core/HttpMethodTag';
import { HttpStatusTagRaw } from './core/HttpStatusTag';
import { Icon, type IconProps } from './core/Icon';
import { KeyValueRow, KeyValueRows } from './core/KeyValueRow';
import type { TimelineViewMode } from './HttpResponsePane';

interface Props {
  response: HttpResponse;
  viewMode: TimelineViewMode;
}

export function HttpResponseTimeline({ response, viewMode }: Props) {
  return <Inner key={response.id} response={response} viewMode={viewMode} />;
}

function Inner({ response, viewMode }: Props) {
  const [showRaw, setShowRaw] = useState(false);
  const { data: events, error, isLoading } = useHttpResponseEvents(response);

  // Generate plain text representation of all events (with prefixes for timeline view)
  const plainText = useMemo(() => {
    if (!events || events.length === 0) return '';
    return events.map((event) => formatEventText(event.event, true)).join('\n');
  }, [events]);

  // Plain text view - show all events as text in an editor
  if (viewMode === 'text') {
    if (isLoading) {
      return <div className="p-4 text-text-subtlest">Loading events...</div>;
    } else if (error) {
      return <div className="p-4 text-danger">{String(error)}</div>;
    } else if (!events || events.length === 0) {
      return <div className="p-4 text-text-subtlest">No events recorded</div>;
    } else {
      return (
        <Editor language="timeline" defaultValue={plainText} readOnly stateKey={null} hideGutter />
      );
    }
  }

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
    // Raw view - show plaintext representation (without prefix)
    if (showRaw) {
      const rawText = formatEventText(event.event, false);
      return <Editor language="text" defaultValue={rawText} readOnly stateKey={null} hideGutter />;
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

    // Request URL - show all URL parts separately
    if (e.type === 'send_url') {
      const auth = e.username || e.password ? `${e.username}:${e.password}@` : '';
      const isDefaultPort =
        (e.scheme === 'http' && e.port === 80) || (e.scheme === 'https' && e.port === 443);
      const portStr = isDefaultPort ? '' : `:${e.port}`;
      const query = e.query ? `?${e.query}` : '';
      const fragment = e.fragment ? `#${e.fragment}` : '';
      const fullUrl = `${e.scheme}://${auth}${e.host}${portStr}${e.path}${query}${fragment}`;
      return (
        <KeyValueRows>
          <KeyValueRow label="URL">{fullUrl}</KeyValueRow>
          <KeyValueRow label="Method">{e.method}</KeyValueRow>
          <KeyValueRow label="Scheme">{e.scheme}</KeyValueRow>
          {e.username ? <KeyValueRow label="Username">{e.username}</KeyValueRow> : null}
          {e.password ? <KeyValueRow label="Password">{e.password}</KeyValueRow> : null}
          <KeyValueRow label="Host">{e.host}</KeyValueRow>
          {!isDefaultPort ? <KeyValueRow label="Port">{e.port}</KeyValueRow> : null}
          <KeyValueRow label="Path">{e.path}</KeyValueRow>
          {e.query ? <KeyValueRow label="Query">{e.query}</KeyValueRow> : null}
          {e.fragment ? <KeyValueRow label="Fragment">{e.fragment}</KeyValueRow> : null}
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
      <EventDetailHeader
        title={title}
        timestamp={event.createdAt}
        actions={actions}
        onClose={onClose}
      />
      {renderContent()}
    </div>
  );
}

type EventTextParts = { prefix: '>' | '<' | '*'; text: string };

/** Get the prefix and text for an event */
function getEventTextParts(event: HttpResponseEventData): EventTextParts {
  switch (event.type) {
    case 'send_url':
      return {
        prefix: '>',
        text: `${event.method} ${event.path}${event.query ? `?${event.query}` : ''}${event.fragment ? `#${event.fragment}` : ''}`,
      };
    case 'receive_url':
      return { prefix: '<', text: `${event.version} ${event.status}` };
    case 'header_up':
      return { prefix: '>', text: `${event.name}: ${event.value}` };
    case 'header_down':
      return { prefix: '<', text: `${event.name}: ${event.value}` };
    case 'redirect': {
      const behavior = event.behavior === 'drop_body' ? 'drop body' : 'preserve';
      return { prefix: '*', text: `Redirect ${event.status} -> ${event.url} (${behavior})` };
    }
    case 'setting':
      return { prefix: '*', text: `Setting ${event.name}=${event.value}` };
    case 'info':
      return { prefix: '*', text: event.message };
    case 'chunk_sent':
      return { prefix: '*', text: `[${formatBytes(event.bytes)} sent]` };
    case 'chunk_received':
      return { prefix: '*', text: `[${formatBytes(event.bytes)} received]` };
    case 'dns_resolved':
      if (event.overridden) {
        return {
          prefix: '*',
          text: `DNS override ${event.hostname} -> ${event.addresses.join(', ')}`,
        };
      }
      return {
        prefix: '*',
        text: `DNS resolved ${event.hostname} to ${event.addresses.join(', ')} (${event.duration}ms)`,
      };
    default:
      return { prefix: '*', text: '[unknown event]' };
  }
}

/** Format event as plaintext, optionally with curl-style prefix (> outgoing, < incoming, * info) */
function formatEventText(event: HttpResponseEventData, includePrefix: boolean): string {
  const { prefix, text } = getEventTextParts(event);
  return includePrefix ? `${prefix} ${text}` : text;
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
        summary: `${event.method} ${event.path}${event.query ? `?${event.query}` : ''}${event.fragment ? `#${event.fragment}` : ''}`,
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
