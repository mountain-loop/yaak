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
import { copyToClipboard } from '../lib/copy';
import { Button } from './core/Button';
import { Editor } from './core/Editor/LazyEditor';
import { EventViewer } from './core/EventViewer';
import { EventViewerRow } from './core/EventViewerRow';
import { HotkeyList } from './core/HotkeyList';
import { Icon } from './core/Icon';
import { IconButton } from './core/IconButton';
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
  const [activeEventIndex, setActiveEventIndex] = useState<number | null>(null);
  const [showLarge, setShowLarge] = useStateWithDeps<boolean>(false, [activeRequest.id]);
  const [showingLarge, setShowingLarge] = useState<boolean>(false);
  const [hexDumps, setHexDumps] = useState<Record<number, boolean>>({});

  const activeConnection = useAtomValue(activeWebsocketConnectionAtom);
  const connections = useAtomValue(activeWebsocketConnectionsAtom);
  const events = useWebsocketEvents(activeConnection?.id ?? null);

  const activeEvent = useMemo(
    () => (activeEventIndex != null ? events[activeEventIndex] : null),
    [activeEventIndex, events],
  );

  const hexDump =
    hexDumps[activeEventIndex ?? -1] ?? activeEvent?.messageType === 'binary';

  const message = useMemo(() => {
    if (hexDump) {
      return activeEvent?.message ? hexy(activeEvent?.message) : '';
    }
    return activeEvent?.message
      ? new TextDecoder('utf-8').decode(Uint8Array.from(activeEvent.message))
      : '';
  }, [activeEvent?.message, hexDump]);

  const language = languageFromContentType(null, message);
  const formattedMessage = useFormatText({ language, text: message, pretty: true });

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
            index={index}
            hexDump={hexDump}
            setHexDump={(v) => setHexDumps({ ...hexDumps, [index]: v })}
            message={message}
            formattedMessage={formattedMessage}
            language={language}
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
    messageType === 'close' || messageType === 'open'
      ? 'secondary'
      : isServer
        ? 'info'
        : 'primary';

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
  index,
  hexDump,
  setHexDump,
  message,
  formattedMessage,
  language,
  showLarge,
  showingLarge,
  setShowLarge,
  setShowingLarge,
}: {
  event: WebsocketEvent;
  index: number;
  hexDump: boolean;
  setHexDump: (v: boolean) => void;
  message: string;
  formattedMessage: string | null;
  language: string;
  showLarge: boolean;
  showingLarge: boolean;
  setShowLarge: (v: boolean) => void;
  setShowingLarge: (v: boolean) => void;
}) {
  const title =
    event.messageType === 'close'
      ? 'Connection Closed'
      : event.messageType === 'open'
        ? 'Connection Open'
        : `Message ${event.isServer ? 'Received' : 'Sent'}`;

  return (
    <div className="h-full grid grid-rows-[auto_minmax(0,1fr)]">
      <div className="h-xs mb-2 grid grid-cols-[minmax(0,1fr)_auto] items-center">
        <div className="font-semibold">{title}</div>
        {message !== '' && (
          <HStack space={1}>
            <Button variant="border" size="xs" onClick={() => setHexDump(!hexDump)}>
              {hexDump ? 'Show Message' : 'Show Hexdump'}
            </Button>
            <IconButton
              title="Copy message"
              icon="copy"
              size="xs"
              onClick={() => copyToClipboard(formattedMessage ?? '')}
            />
          </HStack>
        )}
      </div>
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
