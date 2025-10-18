import type { HttpResponse } from '@yaakapp-internal/models';
import classNames from 'classnames';
import type { CSSProperties, ReactNode } from 'react';
import React, { useCallback, useMemo } from 'react';
import { useLocalStorage } from 'react-use';
import { useCancelHttpResponse } from '../hooks/useCancelHttpResponse';
import { usePinnedHttpResponse } from '../hooks/usePinnedHttpResponse';
import { useResponseViewMode } from '../hooks/useResponseViewMode';
import { getMimeTypeFromContentType } from '../lib/contentType';
import { getContentTypeFromHeaders } from '../lib/model_util';
import { ConfirmLargeResponse } from './ConfirmLargeResponse';
import { Banner } from './core/Banner';
import { CountBadge } from './core/CountBadge';
import { HttpResponseDurationTag } from './core/HttpResponseDurationTag';
import { HotKeyList } from './core/HotKeyList';
import { LoadingIcon } from './core/LoadingIcon';
import { SizeTag } from './core/SizeTag';
import { HStack, VStack } from './core/Stacks';
import { HttpStatusTag } from './core/HttpStatusTag';
import type { TabItem } from './core/Tabs/Tabs';
import { TabContent, Tabs } from './core/Tabs/Tabs';
import { EmptyStateText } from './EmptyStateText';
import { RecentHttpResponsesDropdown } from './RecentHttpResponsesDropdown';
import { ResponseHeaders } from './ResponseHeaders';
import { ResponseInfo } from './ResponseInfo';
import { AudioViewer } from './responseViewers/AudioViewer';
import { CsvViewer } from './responseViewers/CsvViewer';
import { EventStreamViewer } from './responseViewers/EventStreamViewer';
import { HTMLOrTextViewer } from './responseViewers/HTMLOrTextViewer';
import { ImageViewer } from './responseViewers/ImageViewer';
import { PdfViewer } from './responseViewers/PdfViewer';
import { SvgViewer } from './responseViewers/SvgViewer';
import { VideoViewer } from './responseViewers/VideoViewer';
import { ErrorBoundary } from './ErrorBoundary';
import { Button } from './core/Button';

interface Props {
  style?: CSSProperties;
  className?: string;
  activeRequestId: string;
}

const TAB_BODY = 'body';
const TAB_HEADERS = 'headers';
const TAB_INFO = 'info';

export function HttpResponsePane({ style, className, activeRequestId }: Props) {
  const { activeResponse, setPinnedResponseId, responses } = usePinnedHttpResponse(activeRequestId);
  const [viewMode, setViewMode] = useResponseViewMode(activeResponse?.requestId);
  const [activeTabs, setActiveTabs] = useLocalStorage<Record<string, string>>(
    'responsePaneActiveTabs',
    {},
  );
  const contentType = getContentTypeFromHeaders(activeResponse?.headers ?? null);
  const mimeType = contentType == null ? null : getMimeTypeFromContentType(contentType).essence;

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
        value: TAB_HEADERS,
        label: 'Headers',
        rightSlot: (
          <CountBadge
            count={activeResponse?.headers.filter((h) => h.name && h.value).length ?? 0}
          />
        ),
      },
      {
        value: TAB_INFO,
        label: 'Info',
      },
    ],
    [activeResponse?.headers, mimeType, setViewMode, viewMode],
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
        <HotKeyList
          hotkeys={['request.send', 'model.create', 'sidebar.focus', 'url_bar.focus']}
        />
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
                <SizeTag contentLength={activeResponse.contentLength ?? 0} />

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

          {activeResponse?.error ? (
            <Banner color="danger" className="m-2">
              {activeResponse.error}
            </Banner>
          ) : (
            <Tabs
              key={activeRequestId} // Freshen tabs on request change
              value={activeTab}
              onChangeValue={setActiveTab}
              tabs={tabs}
              label="Response"
              className="ml-3 mr-3 mb-3"
              tabListClassName="mt-0.5"
            >
              <TabContent value={TAB_BODY}>
                <ErrorBoundary name="Http Response Viewer">
                  <ConfirmLargeResponse response={activeResponse}>
                    {activeResponse.state === 'initialized' ? (
                      <EmptyStateText>
                        <VStack space={3}>
                          <HStack space={3}>
                            <LoadingIcon className="text-text-subtlest" />
                            Sending Request
                          </HStack>
                          <Button size="sm" variant="border" onClick={() => cancel.mutate()}>Cancel</Button>
                        </VStack>
                      </EmptyStateText>
                    ) : activeResponse.state === 'closed' && activeResponse.contentLength === 0 ? (
                      <EmptyStateText>Empty </EmptyStateText>
                    ) : mimeType?.match(/^text\/event-stream/i) && viewMode === 'pretty' ? (
                      <EventStreamViewer response={activeResponse} />
                    ) : mimeType?.match(/^image\/svg/) ? (
                      <SvgViewer response={activeResponse} />
                    ) : mimeType?.match(/^image/i) ? (
                      <EnsureCompleteResponse response={activeResponse} render={ImageViewer} />
                    ) : mimeType?.match(/^audio/i) ? (
                      <EnsureCompleteResponse response={activeResponse} render={AudioViewer} />
                    ) : mimeType?.match(/^video/i) ? (
                      <EnsureCompleteResponse response={activeResponse} render={VideoViewer} />
                    ) : mimeType?.match(/pdf/i) ? (
                      <EnsureCompleteResponse response={activeResponse} render={PdfViewer} />
                    ) : mimeType?.match(/csv|tab-separated/i) ? (
                      <CsvViewer className="pb-2" response={activeResponse} />
                    ) : (
                      <HTMLOrTextViewer
                        textViewerClassName="-mr-2 bg-surface" // Pull to the right
                        response={activeResponse}
                        pretty={viewMode === 'pretty'}
                      />
                    )}
                  </ConfirmLargeResponse>
                </ErrorBoundary>
              </TabContent>
              <TabContent value={TAB_HEADERS}>
                <ResponseHeaders response={activeResponse} />
              </TabContent>
              <TabContent value={TAB_INFO}>
                <ResponseInfo response={activeResponse} />
              </TabContent>
            </Tabs>
          )}
        </div>
      )}
    </div>
  );
}

function EnsureCompleteResponse({
  response,
  render,
}: {
  response: HttpResponse;
  render: (v: { bodyPath: string }) => ReactNode;
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

  return render({ bodyPath: response.bodyPath });
}
