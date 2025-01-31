import type { WebsocketEvent, WebsocketRequest } from '@yaakapp-internal/models';
import classNames from 'classnames';
import { format } from 'date-fns';
import { hexy } from 'hexy';
import React, { useMemo, useState } from 'react';
import { useCopy } from '../hooks/useCopy';
import { useFormatText } from '../hooks/useFormatText';
import { usePinnedWebsocketConnection } from '../hooks/usePinnedWebsocketConnection';
import { useStateWithDeps } from '../hooks/useStateWithDeps';
import { useWebsocketEvents } from '../hooks/useWebsocketEvents';
import { languageFromContentType } from '../lib/contentType';
import { Banner } from './core/Banner';
import { Button } from './core/Button';
import { Editor } from './core/Editor/Editor';
import { Icon } from './core/Icon';
import { IconButton } from './core/IconButton';
import { Separator } from './core/Separator';
import { SplitLayout } from './core/SplitLayout';
import { HStack, VStack } from './core/Stacks';
import { StatusTag } from './core/StatusTag';
import { EmptyStateText } from './EmptyStateText';
import { RecentWebsocketConnectionsDropdown } from './RecentWebsocketConnectionsDropdown';

interface Props {
  activeRequest: WebsocketRequest;
}

export function WebsocketResponsePane({ activeRequest }: Props) {
  const [activeEventId, setActiveEventId] = useState<string | null>(null);
  const [showLarge, setShowLarge] = useStateWithDeps<boolean>(false, [activeRequest.id]);
  const [showingLarge, setShowingLarge] = useState<boolean>(false);
  const [hexDumps, setHexDumps] = useState<Record<string, boolean>>({});

  const { activeConnection, connections, setPinnedConnectionId } =
    usePinnedWebsocketConnection(activeRequest);

  // const isLoading = activeConnection !== null && activeConnection.state !== 'closed';
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
    const text = activeEvent?.message
      ? new TextDecoder('utf-8').decode(Uint8Array.from(activeEvent.message))
      : '';
    return text;
  }, [activeEvent?.message, hexDump]);

  const language = languageFromContentType(null, message);
  const formattedContent = useFormatText({ language, text: message, pretty: true });
  const copy = useCopy();

  return (
    <SplitLayout
      layout="vertical"
      name="grpc_events"
      defaultRatio={0.4}
      minHeightPx={20}
      firstSlot={() =>
        activeConnection && (
          <div className="w-full grid grid-rows-[auto_minmax(0,1fr)] items-center">
            <HStack className="pl-3 mb-1 font-mono text-sm">
              <HStack space={2}>
                {activeConnection.state !== 'closed' && (
                  <Icon icon="refresh" size="sm" spin className="text-text-subtlest" />
                )}
                <StatusTag showReason response={activeConnection} />
                <span>&bull;</span>
                <span>{events.length} Messages</span>
              </HStack>
              <div className="ml-auto">
                <RecentWebsocketConnectionsDropdown
                  connections={connections}
                  activeConnection={activeConnection}
                  onPinnedConnectionId={setPinnedConnectionId}
                />
              </div>
            </HStack>
            <div className="overflow-y-auto h-full">
              {activeConnection.error && (
                <Banner color="danger" className="m-3">
                  {activeConnection.error}
                </Banner>
              )}
              {...events.map((e) => (
                <EventRow
                  key={e.id}
                  event={e}
                  isActive={e.id === activeEventId}
                  onClick={() => {
                    if (e.id === activeEventId) setActiveEventId(null);
                    else setActiveEventId(e.id);
                  }}
                />
              ))}
            </div>
          </div>
        )
      }
      secondSlot={
        activeEvent &&
        (() => (
          <div className="grid grid-rows-[auto_minmax(0,1fr)]">
            <div className="pb-3 px-2">
              <Separator />
            </div>
            <div className="mx-2 overflow-y-auto grid grid-rows-[auto_minmax(0,1fr)]">
              <div className="mb-2 select-text cursor-text grid grid-cols-[minmax(0,1fr)_auto] items-center">
                <div className="font-semibold">
                  {activeEvent.messageType === 'close'
                    ? 'Connection Closed'
                    : `Message ${activeEvent.isServer ? 'Received' : 'Sent'}`}
                </div>
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
                    onClick={() => copy(message)}
                  />
                </HStack>
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
                  defaultValue={formattedContent.data ?? ''}
                  wrapLines={false}
                  readOnly={true}
                  stateKey={null}
                />
              )}
            </div>
          </div>
        ))
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
  const message = messageBytes
    ? new TextDecoder('utf-8').decode(Uint8Array.from(messageBytes))
    : '';
  return (
    <div className="px-1">
      <button
        onClick={onClick}
        className={classNames(
          'w-full grid grid-cols-[auto_minmax(0,3fr)_auto] gap-2 items-center text-left',
          'px-1.5 py-1 font-mono cursor-default group focus:outline-none rounded',
          isActive && '!bg-surface-highlight !text-text',
          'text-text-subtle hover:text',
        )}
      >
        <Icon
          className={classNames(
            messageType === 'close' ? 'text-secondary' : isServer ? 'text-info' : 'text-primary',
          )}
          icon={
            messageType === 'close'
              ? 'info'
              : isServer
                ? 'arrow_big_down_dash'
                : 'arrow_big_up_dash'
          }
        />
        <div className={classNames('w-full truncate text-xs')}>
          {messageType === 'close'
            ? 'Connection closed by ' + (isServer ? 'server' : 'client')
            : message.slice(0, 1000)}
          {/*{error && <span className="text-warning"> ({error})</span>}*/}
        </div>
        <div className={classNames('opacity-50 text-xs')}>
          {format(createdAt + 'Z', 'HH:mm:ss.SSS')}
        </div>
      </button>
    </div>
  );
}
