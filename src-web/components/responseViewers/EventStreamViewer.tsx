import type { HttpResponse } from '@yaakapp-internal/models';
import type { ServerSentEvent } from '@yaakapp-internal/sse';
import classNames from 'classnames';
import React, { Fragment, useMemo, useState } from 'react';
import { useFormatText } from '../../hooks/useFormatText';
import { useResponseBodyEventSource } from '../../hooks/useResponseBodyEventSource';
import { isJSON } from '../../lib/contentType';
import { AutoScroller } from '../core/AutoScroller';
import { Banner } from '../core/Banner';
import { Button } from '../core/Button';
import type { EditorProps } from '../core/Editor/Editor';
import { Editor } from '../core/Editor/Editor';
import { Icon } from '../core/Icon';
import { InlineCode } from '../core/InlineCode';
import { Separator } from '../core/Separator';
import { SplitLayout } from '../core/SplitLayout';
import { HStack, VStack } from '../core/Stacks';

interface Props {
  response: HttpResponse;
}

export function EventStreamViewer({ response }: Props) {
  return (
    <Fragment
      key={response.id} // force a refresh when the response changes
    >
      <ActualEventStreamViewer response={response} />
    </Fragment>
  );
}

function ActualEventStreamViewer({ response }: Props) {
  const [showLarge, setShowLarge] = useState<boolean>(false);
  const [showingLarge, setShowingLarge] = useState<boolean>(false);
  const [activeEventIndex, setActiveEventIndex] = useState<number | null>(null);
  const events = useResponseBodyEventSource(response);
  const activeEvent = useMemo(
    () => (activeEventIndex == null ? null : events.data?.[activeEventIndex]),
    [activeEventIndex, events],
  );

  const language = useMemo<'text' | 'json'>(() => {
    if (!activeEvent?.data) return 'text';
    return isJSON(activeEvent?.data) ? 'json' : 'text';
  }, [activeEvent?.data]);

  return (
    <SplitLayout
      layout="vertical"
      name="grpc_events"
      defaultRatio={0.4}
      minHeightPx={20}
      firstSlot={() => (
        <AutoScroller
          data={events.data ?? []}
          header={
            events.error && (
              <Banner color="danger" className="m-3">
                {String(events.error)}
              </Banner>
            )
          }
          render={(event, i) => (
            <EventRow
              event={event}
              isActive={i === activeEventIndex}
              index={i}
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
                <div className="pl-2 overflow-y-auto">
                  <HStack space={1.5} className="mb-2 font-semibold">
                    <EventLabels
                      className="text-sm"
                      event={activeEvent}
                      index={activeEventIndex ?? 0}
                    />
                    Message Received
                  </HStack>
                  {!showLarge && activeEvent.data.length > 1000 * 1000 ? (
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
                    <FormattedEditor language={language} text={activeEvent.data} />
                  )}
                </div>
              </div>
            )
          : null
      }
    />
  );
}

function FormattedEditor({ text, language }: { text: string; language: EditorProps['language'] }) {
  const formatted = useFormatText({ text, language, pretty: true });
  if (formatted.data == null) return null;
  return <Editor readOnly defaultValue={formatted.data} language={language} stateKey={null} />;
}

function EventRow({
  onClick,
  isActive,
  event,
  className,
  index,
}: {
  onClick: () => void;
  isActive: boolean;
  event: ServerSentEvent;
  className?: string;
  index: number;
}) {
  return (
    <button
      onClick={onClick}
      className={classNames(
        className,
        'w-full grid grid-cols-[auto_auto_minmax(0,3fr)] gap-2 items-center text-left',
        '-mx-1.5 px-1.5 h-xs font-mono group focus:outline-none focus:text-text rounded',
        isActive && '!bg-surface-active !text-text',
        'text-text-subtle hover:text',
      )}
    >
      <Icon color="info" title="Server Message" icon="arrow_big_down_dash" />
      <EventLabels className="text-sm" event={event} isActive={isActive} index={index} />
      <div className={classNames('w-full truncate text-xs')}>{event.data.slice(0, 1000)}</div>
    </button>
  );
}

function EventLabels({
  className,
  event,
  index,
  isActive,
}: {
  event: ServerSentEvent;
  index: number;
  className: string;
  isActive?: boolean;
}) {
  return (
    <HStack space={1.5} alignItems="center" className={className}>
      <InlineCode className={classNames('py-0', isActive && 'bg-text-subtlest text-text')}>
        {event.id ?? index}
      </InlineCode>
      {event.eventType && (
        <InlineCode className={classNames('py-0', isActive && 'bg-text-subtlest text-text')}>
          {event.eventType}
        </InlineCode>
      )}
    </HStack>
  );
}
