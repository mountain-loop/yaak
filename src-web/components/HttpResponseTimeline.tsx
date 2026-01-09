import type {
  HttpResponse,
  HttpResponseEvent,
  HttpResponseEventData,
} from '@yaakapp-internal/models';
import classNames from 'classnames';
import { format } from 'date-fns';
import { type ReactNode, useMemo, useState } from 'react';
import { useHttpResponseEvents } from '../hooks/useHttpResponseEvents';
import { AutoScroller } from './core/AutoScroller';
import { Banner } from './core/Banner';
import { HttpMethodTagRaw } from './core/HttpMethodTag';
import { HttpStatusTagRaw } from './core/HttpStatusTag';
import { Icon, type IconProps } from './core/Icon';
import { KeyValueRow, KeyValueRows } from './core/KeyValueRow';
import { Separator } from './core/Separator';
import { SplitLayout } from './core/SplitLayout';

interface Props {
  response: HttpResponse;
}

export function HttpResponseTimeline({ response }: Props) {
  return <Inner key={response.id} response={response} />;
}

function Inner({ response }: Props) {
  const [activeEventIndex, setActiveEventIndex] = useState<number | null>(null);
  const { data: events, error, isLoading } = useHttpResponseEvents(response);

  const activeEvent = useMemo(
    () => (activeEventIndex == null ? null : events?.[activeEventIndex]),
    [activeEventIndex, events],
  );

  if (isLoading) {
    return <div className="p-3 text-text-subtlest italic">Loading events...</div>;
  }

  if (error) {
    return (
      <Banner color="danger" className="m-3">
        {String(error)}
      </Banner>
    );
  }

  if (!events || events.length === 0) {
    return <div className="p-3 text-text-subtlest italic">No events recorded</div>;
  }

  return (
    <SplitLayout
      layout="vertical"
      name="http_response_events"
      defaultRatio={0.25}
      minHeightPx={10}
      firstSlot={() => (
        <AutoScroller
          data={events}
          render={(event, i) => (
            <EventRow
              key={event.id}
              event={event}
              isActive={i === activeEventIndex}
              onClick={() => {
                if (i === activeEventIndex) setActiveEventIndex(null);
                else setActiveEventIndex(i);
              }}
            />
          )}
        />
      )}
      secondSlot={
        activeEvent
          ? () => (
              <div className="grid grid-rows-[auto_minmax(0,1fr)]">
                <div className="pb-3 px-2">
                  <Separator />
                </div>
                <div className="mx-2 overflow-y-auto">
                  <EventDetails event={activeEvent} />
                </div>
              </div>
            )
          : null
      }
    />
  );
}

function EventRow({
  onClick,
  isActive,
  event,
}: {
  onClick: () => void;
  isActive: boolean;
  event: HttpResponseEvent;
}) {
  const display = getEventDisplay(event.event);
  const { icon, color, summary } = display;

  return (
    <div className="px-1">
      <button
        type="button"
        onClick={onClick}
        className={classNames(
          'w-full grid grid-cols-[auto_minmax(0,1fr)_auto] gap-2 items-center text-left',
          'px-1.5 h-xs font-mono text-editor cursor-default group focus:outline-none focus:text-text rounded',
          isActive && '!bg-surface-active !text-text',
          'text-text-subtle hover:text',
        )}
      >
        <Icon color={color} icon={icon} size="sm" />
        <div className="w-full truncate">{summary}</div>
        <div className="opacity-50">{format(`${event.createdAt}Z`, 'HH:mm:ss.SSS')}</div>
      </button>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function EventDetails({ event }: { event: HttpResponseEvent }) {
  const { label } = getEventDisplay(event.event);
  const timestamp = format(new Date(`${event.createdAt}Z`), 'HH:mm:ss.SSS');
  const e = event.event;

  // Headers - show name and value with Editor for JSON
  if (e.type === 'header_up' || e.type === 'header_down') {
    return (
      <div className="flex flex-col gap-2 h-full">
        <DetailHeader
          title={e.type === 'header_down' ? 'Header Received' : 'Header Sent'}
          timestamp={timestamp}
        />
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
        <DetailHeader title="Request" timestamp={timestamp} />
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
        <DetailHeader title="Response" timestamp={timestamp} />
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
        <DetailHeader title="Redirect" timestamp={timestamp} />
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
        <DetailHeader title="Apply Setting" timestamp={timestamp} />
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
        <DetailHeader title={`Data ${direction}`} timestamp={timestamp} />
        <div className="font-mono text-editor">{formatBytes(e.bytes)}</div>
      </div>
    );
  }

  // Default - use summary
  const { summary } = getEventDisplay(event.event);
  return (
    <div className="flex flex-col gap-1">
      <DetailHeader title={label} timestamp={timestamp} />
      <div className="font-mono text-editor">{summary}</div>
    </div>
  );
}

function DetailHeader({ title, timestamp }: { title: string; timestamp: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <h3 className="font-semibold select-auto cursor-auto">{title}</h3>
      <span className="text-text-subtlest font-mono text-editor">{timestamp}</span>
    </div>
  );
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
