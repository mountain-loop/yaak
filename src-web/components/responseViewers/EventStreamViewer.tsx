import type { HttpResponse } from '@yaakapp-internal/models';
import type { ServerSentEvent } from '@yaakapp-internal/sse';
import classNames from 'classnames';
import { Fragment, useMemo, useState } from 'react';
import { useFormatText } from '../../hooks/useFormatText';
import { useResponseBodyEventSource } from '../../hooks/useResponseBodyEventSource';
import { isJSON } from '../../lib/contentType';
import { Button } from '../core/Button';
import type { EditorProps } from '../core/Editor/Editor';
import { Editor } from '../core/Editor/LazyEditor';
import { EventDetailHeader, EventViewer } from '../core/EventViewer';
import { EventViewerRow } from '../core/EventViewerRow';
import { Icon } from '../core/Icon';
import { InlineCode } from '../core/InlineCode';
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
  const events = useResponseBodyEventSource(response);

  return (
    <EventViewer
      events={events.data ?? []}
      getEventKey={(_, index) => String(index)}
      error={events.error ? String(events.error) : null}
      splitLayoutName="sse_events"
      defaultRatio={0.4}
      renderRow={({ event, index, isActive, onClick }) => (
        <EventViewerRow
          isActive={isActive}
          onClick={onClick}
          icon={<Icon color="info" title="Server Message" icon="arrow_big_down_dash" />}
          content={
            <HStack space={2} className="items-center">
              <EventLabels event={event} index={index} isActive={isActive} />
              <span className="truncate text-xs">{event.data.slice(0, 1000)}</span>
            </HStack>
          }
        />
      )}
      renderDetail={({ event, index, onClose }) => (
        <EventDetail
          event={event}
          index={index}
          showLarge={showLarge}
          showingLarge={showingLarge}
          setShowLarge={setShowLarge}
          setShowingLarge={setShowingLarge}
          onClose={onClose}
        />
      )}
    />
  );
}

function EventDetail({
  event,
  index,
  showLarge,
  showingLarge,
  setShowLarge,
  setShowingLarge,
  onClose,
}: {
  event: ServerSentEvent;
  index: number;
  showLarge: boolean;
  showingLarge: boolean;
  setShowLarge: (v: boolean) => void;
  setShowingLarge: (v: boolean) => void;
  onClose: () => void;
}) {
  const language = useMemo<'text' | 'json'>(() => {
    if (!event?.data) return 'text';
    return isJSON(event?.data) ? 'json' : 'text';
  }, [event?.data]);

  return (
    <div className="flex flex-col h-full">
      <EventDetailHeader
        title="Message Received"
        prefix={<EventLabels event={event} index={index} />}
        onClose={onClose}
      />
      {!showLarge && event.data.length > 1000 * 1000 ? (
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
        <FormattedEditor language={language} text={event.data} />
      )}
    </div>
  );
}

function FormattedEditor({ text, language }: { text: string; language: EditorProps['language'] }) {
  const formatted = useFormatText({ text, language, pretty: true });
  if (formatted == null) return null;
  return <Editor readOnly defaultValue={formatted} language={language} stateKey={null} />;
}

function EventLabels({
  className,
  event,
  index,
  isActive,
}: {
  event: ServerSentEvent;
  index: number;
  className?: string;
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
