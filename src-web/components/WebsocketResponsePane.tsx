import type { WebsocketEvent, WebsocketRequest } from '@yaakapp-internal/models';
import { hexy } from 'hexy';
import { useAtomValue } from 'jotai';
import { useMemo, useState } from 'react';
import { useFormatText } from '../hooks/useFormatText';
import {
  activeWebsocketConnectionAtom,
  activeWebsocketConnectionsAtom,
  setPinnedWebsocketConnectionId,
  useWebsocketEvents,
} from '../hooks/usePinnedWebsocketConnection';
import { useStateWithDeps } from '../hooks/useStateWithDeps';
import { languageFromContentType } from '../lib/contentType';
import { Button } from './core/Button';
import { Editor } from './core/Editor/LazyEditor';
import { EventDetailHeader, EventViewer, type EventDetailAction } from './core/EventViewer';
import { EventViewerRow } from './core/EventViewerRow';
import { HotkeyList } from './core/HotkeyList';
import { Icon } from './core/Icon';
import { LoadingIcon } from './core/LoadingIcon';
import { HStack, VStack } from './core/Stacks';
import { WebsocketStatusTag } from './core/WebsocketStatusTag';
import { EmptyStateText } from './EmptyStateText';
import { ErrorBoundary } from './ErrorBoundary';
import { RecentWebsocketConnectionsDropdown } from './RecentWebsocketConnectionsDropdown';

interface Props {
  activeRequest: WebsocketRequest;
}

export function WebsocketResponsePane({ activeRequest }: Props) {
  const [showLarge, setShowLarge] = useStateWithDeps<boolean>(false, [activeRequest.id]);
  const [showingLarge, setShowingLarge] = useState<boolean>(false);
  const [hexDumps, setHexDumps] = useState<Record<number, boolean>>({});

  const activeConnection = useAtomValue(activeWebsocketConnectionAtom);
  const connections = useAtomValue(activeWebsocketConnectionsAtom);
  const events = useWebsocketEvents(activeConnection?.id ?? null);

  if (activeConnection == null) {
    return (
      <HotkeyList hotkeys={['request.send', 'model.create', 'sidebar.focus', 'url_bar.focus']} />
    );
  }

  const header = (
    <HStack className="pl-3 mb-1 font-mono text-sm text-text-subtle">
      <HStack space={2}>
        {activeConnection.state !== 'closed' && (
          <LoadingIcon size="sm" className="text-text-subtlest" />
        )}
        <WebsocketStatusTag connection={activeConnection} />
        <span>&bull;</span>
        <span>{events.length} Messages</span>
      </HStack>
      <HStack space={0.5} className="ml-auto">
        <RecentWebsocketConnectionsDropdown
          connections={connections}
          activeConnection={activeConnection}
          onPinnedConnectionId={setPinnedWebsocketConnectionId}
        />
      </HStack>
    </HStack>
  );

  return (
    <ErrorBoundary name="Websocket Events">
      <EventViewer
        events={events}
        getEventKey={(event) => event.id}
        error={activeConnection.error}
        header={header}
        splitLayoutName="websocket_events"
        defaultRatio={0.4}
        renderRow={({ event, isActive, onClick }) => (
          <WebsocketEventRow event={event} isActive={isActive} onClick={onClick} />
        )}
        renderDetail={({ event, index }) => (
          <WebsocketEventDetail
            event={event}
            hexDump={hexDumps[index] ?? event.messageType === 'binary'}
            setHexDump={(v) => setHexDumps({ ...hexDumps, [index]: v })}
            showLarge={showLarge}
            showingLarge={showingLarge}
            setShowLarge={setShowLarge}
            setShowingLarge={setShowingLarge}
          />
        )}
      />
    </ErrorBoundary>
  );
}

function WebsocketEventRow({
  event,
  isActive,
  onClick,
}: {
  event: WebsocketEvent;
  isActive: boolean;
  onClick: () => void;
}) {
  const { message: messageBytes, isServer, messageType } = event;
  const message = messageBytes
    ? new TextDecoder('utf-8').decode(Uint8Array.from(messageBytes))
    : '';

  const iconColor =
    messageType === 'close' || messageType === 'open' ? 'secondary' : isServer ? 'info' : 'primary';

  const icon =
    messageType === 'close' || messageType === 'open'
      ? 'info'
      : isServer
        ? 'arrow_big_down_dash'
        : 'arrow_big_up_dash';

  const content =
    messageType === 'close' ? (
      'Disconnected from server'
    ) : messageType === 'open' ? (
      'Connected to server'
    ) : message === '' ? (
      <em className="italic text-text-subtlest">No content</em>
    ) : (
      <span className="text-xs">{message.slice(0, 1000)}</span>
    );

  return (
    <EventViewerRow
      isActive={isActive}
      onClick={onClick}
      icon={<Icon color={iconColor} icon={icon} />}
      content={content}
      timestamp={event.createdAt}
    />
  );
}

function WebsocketEventDetail({
  event,
  hexDump,
  setHexDump,
  showLarge,
  showingLarge,
  setShowLarge,
  setShowingLarge,
}: {
  event: WebsocketEvent;
  hexDump: boolean;
  setHexDump: (v: boolean) => void;
  showLarge: boolean;
  showingLarge: boolean;
  setShowLarge: (v: boolean) => void;
  setShowingLarge: (v: boolean) => void;
}) {
  const message = useMemo(() => {
    if (hexDump) {
      return event.message ? hexy(event.message) : '';
    }
    return event.message ? new TextDecoder('utf-8').decode(Uint8Array.from(event.message)) : '';
  }, [event.message, hexDump]);

  const language = languageFromContentType(null, message);
  const formattedMessage = useFormatText({ language, text: message, pretty: true });

  const title =
    event.messageType === 'close'
      ? 'Connection Closed'
      : event.messageType === 'open'
        ? 'Connection Open'
        : `Message ${event.isServer ? 'Received' : 'Sent'}`;

  const actions: EventDetailAction[] =
    message !== ''
      ? [
          {
            key: 'toggle-hexdump',
            label: hexDump ? 'Show Message' : 'Show Hexdump',
            onClick: () => setHexDump(!hexDump),
          },
        ]
      : [];

  return (
    <div className="h-full grid grid-rows-[auto_minmax(0,1fr)]">
      <EventDetailHeader
          title={title}
          timestamp={event.createdAt}
          actions={actions}
          copyText={formattedMessage || undefined}
        />
      {!showLarge && event.message.length > 1000 * 1000 ? (
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
      ) : event.message.length === 0 ? (
        <EmptyStateText>No Content</EmptyStateText>
      ) : (
        <Editor
          language={language}
          defaultValue={formattedMessage ?? ''}
          wrapLines={false}
          readOnly={true}
          stateKey={null}
        />
      )}
    </div>
  );
}
