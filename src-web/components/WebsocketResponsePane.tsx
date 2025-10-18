import type { WebsocketEvent, WebsocketRequest } from '@yaakapp-internal/models';
import classNames from 'classnames';
import { format } from 'date-fns';
import { hexy } from 'hexy';
import { useAtomValue } from 'jotai';
import { useMemo, useRef, useState } from 'react';
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
import { AutoScroller } from './core/AutoScroller';
import { Banner } from './core/Banner';
import { Button } from './core/Button';
import { Editor } from './core/Editor/Editor';
import { HotKeyList } from './core/HotKeyList';
import { Icon } from './core/Icon';
import { IconButton } from './core/IconButton';
import { LoadingIcon } from './core/LoadingIcon';
import { Separator } from './core/Separator';
import { SplitLayout } from './core/SplitLayout';
import { HStack, VStack } from './core/Stacks';
import { WebsocketStatusTag } from './core/WebsocketStatusTag';
import { EmptyStateText } from './EmptyStateText';
import { ErrorBoundary } from './ErrorBoundary';
import { RecentWebsocketConnectionsDropdown } from './RecentWebsocketConnectionsDropdown';

interface Props {
  activeRequest: WebsocketRequest;
}

export function WebsocketResponsePane({ activeRequest }: Props) {
  const [activeEventId, setActiveEventId] = useState<string | null>(null);
  const [showLarge, setShowLarge] = useStateWithDeps<boolean>(false, [activeRequest.id]);
  const [showingLarge, setShowingLarge] = useState<boolean>(false);
  const [hexDumps, setHexDumps] = useState<Record<string, boolean>>({});

  const activeConnection = useAtomValue(activeWebsocketConnectionAtom);
  const connections = useAtomValue(activeWebsocketConnectionsAtom);
  const events = useWebsocketEvents(activeConnection?.id ?? null);

  const activeEvent = useMemo(
    () => events.find((m) => m.id === activeEventId) ?? null,
    [activeEventId, events],
  );

  const hexDump = hexDumps[activeEventId ?? 'n/a'] ?? activeEvent?.messageType === 'binary';

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

  return (
    <SplitLayout
      layout="vertical"
      name="grpc_events"
      defaultRatio={0.4}
      minHeightPx={20}
      firstSlot={() =>
        activeConnection == null ? (
          <HotKeyList
            hotkeys={['request.send', 'model.create', 'sidebar.focus', 'url_bar.focus']}
          />
        ) : (
          <div className="w-full grid grid-rows-[auto_minmax(0,1fr)] items-center">
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
            <ErrorBoundary name="Websocket Events">
              <AutoScroller
                data={events}
                header={
                  activeConnection.error && (
                    <Banner color="danger" className="m-3">
                      {activeConnection.error}
                    </Banner>
                  )
                }
                render={(event) => (
                  <EventRow
                    key={event.id}
                    event={event}
                    isActive={event.id === activeEventId}
                    onClick={() => {
                      if (event.id === activeEventId) setActiveEventId(null);
                      else setActiveEventId(event.id);
                    }}
                  />
                )}
              />
            </ErrorBoundary>
          </div>
        )
      }
      secondSlot={
        activeEvent != null && activeConnection != null
          ? () => (
              <div className="grid grid-rows-[auto_minmax(0,1fr)]">
                <div className="pb-3 px-2">
                  <Separator />
                </div>
                <div className="mx-2 overflow-y-auto grid grid-rows-[auto_minmax(0,1fr)]">
                  <div className="h-xs mb-2 grid grid-cols-[minmax(0,1fr)_auto] items-center">
                    <div className="font-semibold">
                      {activeEvent.messageType === 'close'
                        ? 'Connection Closed'
                        : activeEvent.messageType === 'open'
                          ? 'Connection open'
                          : `Message ${activeEvent.isServer ? 'Received' : 'Sent'}`}
                    </div>
                    {message != '' && (
                      <HStack space={1}>
                        <Button
                          variant="border"
                          size="xs"
                          onClick={() => {
                            if (activeEventId == null) return;
                            setHexDumps({ ...hexDumps, [activeEventId]: !hexDump });
                          }}
                        >
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
                  {!showLarge && activeEvent.message.length > 1000 * 1000 ? (
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
                  ) : activeEvent.message.length === 0 ? (
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
  onClick?: () => void;
  isActive?: boolean;
  event: WebsocketEvent;
}) {
  const { createdAt, message: messageBytes, isServer, messageType } = event;
  const ref = useRef<HTMLDivElement>(null);
  const message = messageBytes
    ? new TextDecoder('utf-8').decode(Uint8Array.from(messageBytes))
    : '';

  return (
    <div className="px-1" ref={ref}>
      <button
        onClick={onClick}
        className={classNames(
          'w-full grid grid-cols-[auto_minmax(0,3fr)_auto] gap-2 items-center text-left',
          'px-1.5 h-xs font-mono cursor-default group focus:outline-none focus:text-text rounded',
          isActive && '!bg-surface-active !text-text',
          'text-text-subtle hover:text',
        )}
      >
        <Icon
          color={
            messageType === 'close' || messageType === 'open'
              ? 'secondary'
              : isServer
                ? 'info'
                : 'primary'
          }
          icon={
            messageType === 'close' || messageType === 'open'
              ? 'info'
              : isServer
                ? 'arrow_big_down_dash'
                : 'arrow_big_up_dash'
          }
        />
        <div className={classNames('w-full truncate text-xs')}>
          {messageType === 'close' ? (
            'Disconnected from server'
          ) : messageType === 'open' ? (
            'Connected to server'
          ) : message === '' ? (
            <em className="italic text-text-subtlest">No content</em>
          ) : (
            message.slice(0, 1000)
          )}
          {/*{error && <span className="text-warning"> ({error})</span>}*/}
        </div>
        <div className={classNames('opacity-50 text-xs')}>
          {format(createdAt + 'Z', 'HH:mm:ss.SSS')}
        </div>
      </button>
    </div>
  );
}
