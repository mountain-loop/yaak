import type { WebsocketEvent, WebsocketRequest } from '@yaakapp-internal/models';
import classNames from 'classnames';
import { format } from 'date-fns';
import React, { useMemo, useState } from 'react';
import { useStateWithDeps } from '../hooks/useStateWithDeps';
import { useLatestWebsocketConnection } from '../hooks/useWebsocketConnections';
import { useWebsocketEvents } from '../hooks/useWebsocketEvents';
import { languageFromContentType } from '../lib/contentType';
import { Banner } from './core/Banner';
import { Button } from './core/Button';
import { Editor } from './core/Editor/Editor';
import { Icon } from './core/Icon';
import { JsonAttributeTree } from './core/JsonAttributeTree';
import { Separator } from './core/Separator';
import { SplitLayout } from './core/SplitLayout';
import { HStack, VStack } from './core/Stacks';

interface Props {
  activeRequest: WebsocketRequest;
}

export function WebsocketResponsePane({ activeRequest }: Props) {
  const activeConnection = useLatestWebsocketConnection(activeRequest.id);
  // const isLoading = activeConnection !== null && activeConnection.state !== 'closed';
  const events = useWebsocketEvents(activeConnection?.id ?? null);

  const [activeEventId, setActiveEventId] = useState<string | null>(null);
  const [showLarge, setShowLarge] = useStateWithDeps<boolean>(false, [activeRequest.id]);
  const [showingLarge, setShowingLarge] = useState<boolean>(false);
  // const { activeConnection, connections, setPinnedConnectionId } =
  //   usePinnedGrpcConnection(activeRequest);

  const activeEvent = useMemo(
    () => events.find((m) => m.id === activeEventId) ?? null,
    [activeEventId, events],
  );

  const content = activeEvent
    ? new TextDecoder('utf-8').decode(Uint8Array.from(activeEvent.content))
    : '';

  const language = languageFromContentType(null, content);

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
                <span>{events.length} Messages</span>
                {activeConnection.state !== 'closed' && (
                  <Icon icon="refresh" size="sm" spin className="text-text-subtlest" />
                )}
              </HStack>
              {/*<RecentConnectionsDropdown*/}
              {/*  connections={connections}*/}
              {/*  activeConnection={activeConnection}*/}
              {/*  onPinnedConnectionId={setPinnedConnectionId}*/}
              {/*/>*/}
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
            <div className="pl-2 overflow-y-auto">
              <div className="mb-2 select-text cursor-text font-semibold">Message</div>
              {!showLarge && activeEvent.content.length > 1000 * 1000 ? (
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
              ) : language === 'json' ? (
                <JsonAttributeTree attrValue={JSON.parse(content ?? '{}')} />
              ) : (
                <Editor defaultValue={content} readOnly={true} stateKey={null} />
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
  const { createdAt, content: contentBytes } = event;
  const content = contentBytes
    ? new TextDecoder('utf-8').decode(Uint8Array.from(contentBytes))
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
        <Icon className="text-text-subtle" icon="info" />
        <div className={classNames('w-full truncate text-xs')}>
          {content.slice(0, 1000)}
          {/*{error && <span className="text-warning"> ({error})</span>}*/}
        </div>
        <div className={classNames('opacity-50 text-xs')}>
          {format(createdAt + 'Z', 'HH:mm:ss.SSS')}
        </div>
      </button>
    </div>
  );
}
