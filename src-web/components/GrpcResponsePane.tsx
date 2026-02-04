import type { GrpcEvent, GrpcRequest } from '@yaakapp-internal/models';
import { useAtomValue, useSetAtom } from 'jotai';
import type { CSSProperties } from 'react';
import { useEffect, useMemo, useState } from 'react';
import {
  activeGrpcConnectionAtom,
  activeGrpcConnections,
  pinnedGrpcConnectionIdAtom,
  useGrpcEvents,
} from '../hooks/usePinnedGrpcConnection';
import { useStateWithDeps } from '../hooks/useStateWithDeps';
import { Button } from './core/Button';
import { Editor } from './core/Editor/LazyEditor';
import { EventDetailHeader, EventViewer } from './core/EventViewer';
import { EventViewerRow } from './core/EventViewerRow';
import { HotkeyList } from './core/HotkeyList';
import { Icon, type IconProps } from './core/Icon';
import { KeyValueRow, KeyValueRows } from './core/KeyValueRow';
import { LoadingIcon } from './core/LoadingIcon';
import { HStack, VStack } from './core/Stacks';
import { EmptyStateText } from './EmptyStateText';
import { ErrorBoundary } from './ErrorBoundary';
import { RecentGrpcConnectionsDropdown } from './RecentGrpcConnectionsDropdown';

interface Props {
  style?: CSSProperties;
  className?: string;
  activeRequest: GrpcRequest;
  methodType:
    | 'unary'
    | 'client_streaming'
    | 'server_streaming'
    | 'streaming'
    | 'no-schema'
    | 'no-method';
}

export function GrpcResponsePane({ style, methodType, activeRequest }: Props) {
  const [activeEventIndex, setActiveEventIndex] = useState<number | null>(null);
  const [showLarge, setShowLarge] = useStateWithDeps<boolean>(false, [activeRequest.id]);
  const [showingLarge, setShowingLarge] = useState<boolean>(false);
  const connections = useAtomValue(activeGrpcConnections);
  const activeConnection = useAtomValue(activeGrpcConnectionAtom);
  const events = useGrpcEvents(activeConnection?.id ?? null);
  const setPinnedGrpcConnectionId = useSetAtom(pinnedGrpcConnectionIdAtom);

  const activeEvent = useMemo(
    () => (activeEventIndex != null ? events[activeEventIndex] : null),
    [activeEventIndex, events],
  );

  // Set the active message to the first message received if unary
  // biome-ignore lint/correctness/useExhaustiveDependencies: none
  useEffect(() => {
    if (events.length === 0 || activeEvent != null || methodType !== 'unary') {
      return;
    }
    const firstServerMessageIndex = events.findIndex((m) => m.eventType === 'server_message');
    if (firstServerMessageIndex !== -1) {
      setActiveEventIndex(firstServerMessageIndex);
    }
  }, [events.length]);

  if (activeConnection == null) {
    return (
      <HotkeyList hotkeys={['request.send', 'model.create', 'sidebar.focus', 'url_bar.focus']} />
    );
  }

  const header = (
    <HStack className="pl-3 mb-1 font-mono text-sm text-text-subtle overflow-x-auto hide-scrollbars">
      <HStack space={2}>
        <span className="whitespace-nowrap">{events.length} Messages</span>
        {activeConnection.state !== 'closed' && (
          <LoadingIcon size="sm" className="text-text-subtlest" />
        )}
      </HStack>
      <div className="ml-auto">
        <RecentGrpcConnectionsDropdown
          connections={connections}
          activeConnection={activeConnection}
          onPinnedConnectionId={setPinnedGrpcConnectionId}
        />
      </div>
    </HStack>
  );

  return (
    <div style={style} className="h-full">
      <ErrorBoundary name="GRPC Events">
        <EventViewer
          events={events}
          getEventKey={(event) => event.id}
          error={activeConnection.error}
          header={header}
          splitLayoutName="grpc_events"
          defaultRatio={0.4}
          renderRow={({ event, isActive, onClick }) => (
            <GrpcEventRow event={event} isActive={isActive} onClick={onClick} />
          )}
          renderDetail={({ event, onClose }) => (
            <GrpcEventDetail
              event={event}
              showLarge={showLarge}
              showingLarge={showingLarge}
              setShowLarge={setShowLarge}
              setShowingLarge={setShowingLarge}
              onClose={onClose}
            />
          )}
        />
      </ErrorBoundary>
    </div>
  );
}

function GrpcEventRow({
  event,
  isActive,
  onClick,
}: {
  event: GrpcEvent;
  isActive: boolean;
  onClick: () => void;
}) {
  const { eventType, status, content, error } = event;
  const display = getEventDisplay(eventType, status);

  return (
    <EventViewerRow
      isActive={isActive}
      onClick={onClick}
      icon={<Icon color={display.color} title={display.title} icon={display.icon} />}
      content={
        <span className="text-xs">
          {content.slice(0, 1000)}
          {error && <span className="text-warning"> ({error})</span>}
        </span>
      }
      timestamp={event.createdAt}
    />
  );
}

function GrpcEventDetail({
  event,
  showLarge,
  showingLarge,
  setShowLarge,
  setShowingLarge,
  onClose,
}: {
  event: GrpcEvent;
  showLarge: boolean;
  showingLarge: boolean;
  setShowLarge: (v: boolean) => void;
  setShowingLarge: (v: boolean) => void;
  onClose: () => void;
}) {
  if (event.eventType === 'client_message' || event.eventType === 'server_message') {
    const title = `Message ${event.eventType === 'client_message' ? 'Sent' : 'Received'}`;

    return (
      <div className="h-full grid grid-rows-[auto_minmax(0,1fr)]">
        <EventDetailHeader
          title={title}
          timestamp={event.createdAt}
          copyText={event.content}
          onClose={onClose}
        />
        {!showLarge && event.content.length > 1000 * 1000 ? (
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
          <Editor
            language="json"
            defaultValue={event.content ?? ''}
            wrapLines={false}
            readOnly={true}
            stateKey={null}
          />
        )}
      </div>
    );
  }

  // Error or connection_end - show metadata/trailers
  return (
    <div className="h-full grid grid-rows-[auto_minmax(0,1fr)]">
      <EventDetailHeader title={event.content} timestamp={event.createdAt} onClose={onClose} />
      {event.error && (
        <div className="select-text cursor-text text-sm font-mono py-1 text-warning">
          {event.error}
        </div>
      )}
      <div className="py-2 h-full">
        {Object.keys(event.metadata).length === 0 ? (
          <EmptyStateText>
            No {event.eventType === 'connection_end' ? 'trailers' : 'metadata'}
          </EmptyStateText>
        ) : (
          <KeyValueRows>
            {Object.entries(event.metadata).map(([key, value]) => (
              <KeyValueRow key={key} label={key}>
                {value}
              </KeyValueRow>
            ))}
          </KeyValueRows>
        )}
      </div>
    </div>
  );
}

function getEventDisplay(
  eventType: GrpcEvent['eventType'],
  status: GrpcEvent['status'],
): { icon: IconProps['icon']; color: IconProps['color']; title: string } {
  if (eventType === 'server_message') {
    return { icon: 'arrow_big_down_dash', color: 'info', title: 'Server message' };
  }
  if (eventType === 'client_message') {
    return { icon: 'arrow_big_up_dash', color: 'primary', title: 'Client message' };
  }
  if (eventType === 'error' || (status != null && status > 0)) {
    return { icon: 'alert_triangle', color: 'danger', title: 'Error' };
  }
  if (eventType === 'connection_end') {
    return { icon: 'check', color: 'success', title: 'Connection response' };
  }
  return { icon: 'info', color: undefined, title: 'Event' };
}
