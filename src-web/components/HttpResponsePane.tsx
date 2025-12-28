import type { HttpResponse } from '@yaakapp-internal/models';
import classNames from 'classnames';
import type { ComponentType, CSSProperties } from 'react';
import { lazy, Suspense, useCallback, useMemo } from 'react';
import { useLocalStorage } from 'react-use';
import { useCancelHttpResponse } from '../hooks/useCancelHttpResponse';
import { useHttpResponseEvents } from '../hooks/useHttpResponseEvents';
import { usePinnedHttpResponse } from '../hooks/usePinnedHttpResponse';
import { useResponseBodyBytes, useResponseBodyText } from '../hooks/useResponseBodyText';
import { useResponseViewMode } from '../hooks/useResponseViewMode';
import { getMimeTypeFromContentType } from '../lib/contentType';
import { getContentTypeFromHeaders } from '../lib/model_util';
import { ConfirmLargeResponse } from './ConfirmLargeResponse';
import { ConfirmLargeResponseRequest } from './ConfirmLargeResponseRequest';
import { Banner } from './core/Banner';
import { Button } from './core/Button';
import { CountBadge } from './core/CountBadge';
import { HotKeyList } from './core/HotKeyList';
import { HttpResponseDurationTag } from './core/HttpResponseDurationTag';
import { HttpStatusTag } from './core/HttpStatusTag';
import { LoadingIcon } from './core/LoadingIcon';
import { SizeTag } from './core/SizeTag';
import { HStack, VStack } from './core/Stacks';
import type { TabItem } from './core/Tabs/Tabs';
import { TabContent, Tabs } from './core/Tabs/Tabs';
import { EmptyStateText } from './EmptyStateText';
import { ErrorBoundary } from './ErrorBoundary';
import { HttpResponseTimeline } from './HttpResponseTimeline';
import { RecentHttpResponsesDropdown } from './RecentHttpResponsesDropdown';
import { RequestBodyViewer } from './RequestBodyViewer';
import { ResponseHeaders } from './ResponseHeaders';
import { ResponseInfo } from './ResponseInfo';
import { AudioViewer } from './responseViewers/AudioViewer';
import { CsvViewer } from './responseViewers/CsvViewer';
import { EventStreamViewer } from './responseViewers/EventStreamViewer';
import { HTMLOrTextViewer } from './responseViewers/HTMLOrTextViewer';
import { ImageViewer } from './responseViewers/ImageViewer';
import { MultipartViewer } from './responseViewers/MultipartViewer';
import { SvgViewer } from './responseViewers/SvgViewer';
import { VideoViewer } from './responseViewers/VideoViewer';

const PdfViewer = lazy(() =>
  import('./responseViewers/PdfViewer').then((m) => ({ default: m.PdfViewer })),
);

interface Props {
  style?: CSSProperties;
  className?: string;
  activeRequestId: string;
}

const TAB_BODY = 'body';
const TAB_REQUEST = 'request';
const TAB_HEADERS = 'headers';
const TAB_INFO = 'info';
const TAB_TIMELINE = 'timeline';

export function HttpResponsePane({ style, className, activeRequestId }: Props) {
  const { activeResponse, setPinnedResponseId, responses } = usePinnedHttpResponse(activeRequestId);
  const [viewMode, setViewMode] = useResponseViewMode(activeResponse?.requestId);
  const [activeTabs, setActiveTabs] = useLocalStorage<Record<string, string>>(
    'responsePaneActiveTabs',
    {},
  );
  const contentType = getContentTypeFromHeaders(activeResponse?.headers ?? null);
  const mimeType = contentType == null ? null : getMimeTypeFromContentType(contentType).essence;

  const responseEvents = useHttpResponseEvents(activeResponse);

  const tabs = useMemo<TabItem[]>(
    () => [
      {
        value: TAB_BODY,
        label: 'Preview Mode',
        options: {
          value: viewMode,
          onChange: setViewMode,
          items: [
            { label: 'Pretty', value: 'pretty' },
            ...(mimeType?.startsWith('image') ? [] : [{ label: 'Raw', value: 'raw' }]),
          ],
        },
      },
      {
        value: TAB_REQUEST,
        label: 'Request',
        rightSlot:
          (activeResponse?.requestContentLength ?? 0) > 0 ? <CountBadge count={true} /> : null,
      },
      {
        value: TAB_HEADERS,
        label: 'Headers',
        rightSlot: (
          <CountBadge
            count2={activeResponse?.headers.length ?? 0}
            count={activeResponse?.requestHeaders.length ?? 0}
          />
        ),
      },
      {
        value: TAB_TIMELINE,
        label: 'Timeline',
        rightSlot: <CountBadge count={responseEvents.data?.length ?? 0} />,
      },
      {
        value: TAB_INFO,
        label: 'Info',
      },
    ],
    [
      activeResponse?.headers,
      activeResponse?.requestContentLength,
      activeResponse?.requestHeaders.length,
      mimeType,
      responseEvents.data?.length,
      setViewMode,
      viewMode,
    ],
  );
  const activeTab = activeTabs?.[activeRequestId];
  const setActiveTab = useCallback(
    (tab: string) => {
      setActiveTabs((r) => ({ ...r, [activeRequestId]: tab }));
    },
    [activeRequestId, setActiveTabs],
  );

  const cancel = useCancelHttpResponse(activeResponse?.id ?? null);

  return (
    <div
      style={style}
      className={classNames(
        className,
        'x-theme-responsePane',
        'max-h-full h-full',
        'bg-surface rounded-md border border-border-subtle overflow-hidden',
        'relative',
      )}
    >
      {activeResponse == null ? (
        <HotKeyList hotkeys={['request.send', 'model.create', 'sidebar.focus', 'url_bar.focus']} />
      ) : (
        <div className="h-full w-full grid grid-rows-[auto_minmax(0,1fr)] grid-cols-1">
          <HStack
            className={classNames(
              'text-text-subtle w-full flex-shrink-0',
              // Remove a bit of space because the tabs have lots too
              '-mb-1.5',
            )}
          >
            {activeResponse && (
              <HStack
                space={2}
                alignItems="center"
                className={classNames(
                  'cursor-default select-none',
                  'whitespace-nowrap w-full pl-3 overflow-x-auto font-mono text-sm hide-scrollbars',
                )}
              >
                {activeResponse.state !== 'closed' && <LoadingIcon size="sm" />}
                <HttpStatusTag showReason response={activeResponse} />
                <span>&bull;</span>
                <HttpResponseDurationTag response={activeResponse} />
                <span>&bull;</span>
                <SizeTag
                  contentLength={activeResponse.contentLength ?? 0}
                  contentLengthCompressed={activeResponse.contentLengthCompressed}
                />

                <div className="ml-auto">
                  <RecentHttpResponsesDropdown
                    responses={responses}
                    activeResponse={activeResponse}
                    onPinnedResponseId={setPinnedResponseId}
                  />
                </div>
              </HStack>
            )}
          </HStack>

          <div className="overflow-hidden flex flex-col min-h-0">
            {activeResponse?.error && (
              <Banner color="danger" className="mx-3 mt-1 flex-shrink-0">
                {activeResponse.error}
              </Banner>
            )}
            {/* Show tabs if we have any data (headers, body, etc.) even if there's an error */}
            <Tabs
              key={activeRequestId} // Freshen tabs on request change
              value={activeTab}
              onChangeValue={setActiveTab}
              tabs={tabs}
              label="Response"
              className="ml-3 mr-3 mb-3 min-h-0 flex-1"
              tabListClassName="mt-0.5"
            >
              <TabContent value={TAB_BODY}>
                <ErrorBoundary name="Http Response Viewer">
                  <Suspense>
                    <ConfirmLargeResponse response={activeResponse}>
                      {activeResponse.state === 'initialized' ? (
                        <EmptyStateText>
                          <VStack space={3}>
                            <HStack space={3}>
                              <LoadingIcon className="text-text-subtlest" />
                              Sending Request
                            </HStack>
                            <Button size="sm" variant="border" onClick={() => cancel.mutate()}>
                              Cancel
                            </Button>
                          </VStack>
                        </EmptyStateText>
                      ) : activeResponse.state === 'closed' &&
                        (activeResponse.contentLength ?? 0) === 0 ? (
                        <EmptyStateText>Empty</EmptyStateText>
                      ) : mimeType?.match(/^text\/event-stream/i) && viewMode === 'pretty' ? (
                        <EventStreamViewer response={activeResponse} />
                      ) : mimeType?.match(/^image\/svg/) ? (
                        <HttpSvgViewer response={activeResponse} />
                      ) : mimeType?.match(/^image/i) ? (
                        <EnsureCompleteResponse response={activeResponse} Component={ImageViewer} />
                      ) : mimeType?.match(/^audio/i) ? (
                        <EnsureCompleteResponse response={activeResponse} Component={AudioViewer} />
                      ) : mimeType?.match(/^video/i) ? (
                        <EnsureCompleteResponse response={activeResponse} Component={VideoViewer} />
                      ) : mimeType?.match(/^multipart/i) && viewMode === 'pretty' ? (
                        <HttpMultipartViewer response={activeResponse} />
                      ) : mimeType?.match(/pdf/i) ? (
                        <EnsureCompleteResponse response={activeResponse} Component={PdfViewer} />
                      ) : mimeType?.match(/csv|tab-separated/i) ? (
                        <HttpCsvViewer className="pb-2" response={activeResponse} />
                      ) : (
                        <HTMLOrTextViewer
                          textViewerClassName="-mr-2 bg-surface" // Pull to the right
                          response={activeResponse}
                          pretty={viewMode === 'pretty'}
                        />
                      )}
                    </ConfirmLargeResponse>
                  </Suspense>
                </ErrorBoundary>
              </TabContent>
              <TabContent value={TAB_REQUEST}>
                <ConfirmLargeResponseRequest response={activeResponse}>
                  <RequestBodyViewer response={activeResponse} />
                </ConfirmLargeResponseRequest>
              </TabContent>
              <TabContent value={TAB_HEADERS}>
                <ResponseHeaders response={activeResponse} />
              </TabContent>
              <TabContent value={TAB_INFO}>
                <ResponseInfo response={activeResponse} />
              </TabContent>
              <TabContent value={TAB_TIMELINE}>
                <HttpResponseTimeline response={activeResponse} />
              </TabContent>
            </Tabs>
          </div>
        </div>
      )}
    </div>
  );
}

function EnsureCompleteResponse({
  response,
  Component,
}: {
  response: HttpResponse;
  Component: ComponentType<{ bodyPath: string }>;
}) {
  if (response.bodyPath === null) {
    return <div>Empty response body</div>;
  }

  // Wait until the response has been fully-downloaded
  if (response.state !== 'closed') {
    return (
      <EmptyStateText>
        <LoadingIcon />
      </EmptyStateText>
    );
  }

  return <Component bodyPath={response.bodyPath} />;
}

function HttpSvgViewer({ response }: { response: HttpResponse }) {
  const body = useResponseBodyText({ response, filter: null });

  if (!body.data) return null;

  return <SvgViewer text={body.data} />;
}

function HttpCsvViewer({ response, className }: { response: HttpResponse; className?: string }) {
  const body = useResponseBodyText({ response, filter: null });

  return <CsvViewer text={body.data ?? null} className={className} />;
}

function HttpMultipartViewer({ response }: { response: HttpResponse }) {
  const body = useResponseBodyBytes({ response });

  if (body.data == null) return null;

  const contentTypeHeader = getContentTypeFromHeaders(response.headers);
  const boundary = contentTypeHeader?.split('boundary=')[1] ?? 'unknown';

  return <MultipartViewer data={body.data} boundary={boundary} idPrefix={response.id} />;
}
