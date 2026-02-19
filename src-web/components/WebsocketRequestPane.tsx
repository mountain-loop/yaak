import type { WebsocketRequest } from '@yaakapp-internal/models';
import { patchModel } from '@yaakapp-internal/models';
import type { GenericCompletionOption } from '@yaakapp-internal/plugins';
import { closeWebsocket, connectWebsocket, sendWebsocket } from '@yaakapp-internal/ws';
import classNames from 'classnames';
import { atom, useAtomValue } from 'jotai';
import type { CSSProperties } from 'react';
import { useCallback, useMemo, useRef } from 'react';
import { getActiveCookieJar } from '../hooks/useActiveCookieJar';
import { getActiveEnvironment } from '../hooks/useActiveEnvironment';
import { activeRequestIdAtom } from '../hooks/useActiveRequestId';
import { allRequestsAtom } from '../hooks/useAllRequests';
import { useAuthTab } from '../hooks/useAuthTab';
import { useCancelHttpResponse } from '../hooks/useCancelHttpResponse';
import { useHeadersTab } from '../hooks/useHeadersTab';
import { useInheritedHeaders } from '../hooks/useInheritedHeaders';
import { usePinnedHttpResponse } from '../hooks/usePinnedHttpResponse';
import { activeWebsocketConnectionAtom } from '../hooks/usePinnedWebsocketConnection';
import { useRequestEditor, useRequestEditorEvent } from '../hooks/useRequestEditor';
import { useRequestUpdateKey } from '../hooks/useRequestUpdateKey';
import { deepEqualAtom } from '../lib/atoms';
import { languageFromContentType } from '../lib/contentType';
import { generateId } from '../lib/generateId';
import { prepareImportQuerystring } from '../lib/prepareImportQuerystring';
import { resolvedModelName } from '../lib/resolvedModelName';
import { CountBadge } from './core/CountBadge';
import type { GenericCompletionConfig } from './core/Editor/genericCompletion';
import { Editor } from './core/Editor/LazyEditor';
import { IconButton } from './core/IconButton';
import type { Pair } from './core/PairEditor';
import { PlainInput } from './core/PlainInput';
import type { TabItem, TabsRef } from './core/Tabs/Tabs';
import { setActiveTab, TabContent, Tabs } from './core/Tabs/Tabs';
import { HeadersEditor } from './HeadersEditor';
import { HttpAuthenticationEditor } from './HttpAuthenticationEditor';
import { MarkdownEditor } from './MarkdownEditor';
import { UrlBar } from './UrlBar';
import { UrlParametersEditor } from './UrlParameterEditor';

interface Props {
  style: CSSProperties;
  fullHeight: boolean;
  className?: string;
  activeRequest: WebsocketRequest;
}

const TAB_MESSAGE = 'message';
const TAB_PARAMS = 'params';
const TAB_HEADERS = 'headers';
const TAB_AUTH = 'auth';
const TAB_DESCRIPTION = 'description';
const TABS_STORAGE_KEY = 'websocket_request_tabs';

const nonActiveRequestUrlsAtom = atom((get) => {
  const activeRequestId = get(activeRequestIdAtom);
  const requests = get(allRequestsAtom);
  return requests
    .filter((r) => r.id !== activeRequestId)
    .map((r): GenericCompletionOption => ({ type: 'constant', label: r.url }));
});

const memoNotActiveRequestUrlsAtom = deepEqualAtom(nonActiveRequestUrlsAtom);

export function WebsocketRequestPane({ style, fullHeight, className, activeRequest }: Props) {
  const activeRequestId = activeRequest.id;
  const tabsRef = useRef<TabsRef>(null);
  const forceUpdateKey = useRequestUpdateKey(activeRequest.id);
  const [{ urlKey }, { forceUrlRefresh, forceParamsRefresh }] = useRequestEditor();
  const authTab = useAuthTab(TAB_AUTH, activeRequest);
  const headersTab = useHeadersTab(TAB_HEADERS, activeRequest);
  const inheritedHeaders = useInheritedHeaders(activeRequest);

  // Listen for event to focus the params tab (e.g., when clicking a :param in the URL)
  useRequestEditorEvent('request_pane.focus_tab', () => {
    tabsRef.current?.setActiveTab(TAB_PARAMS);
  }, []);

  const { urlParameterPairs, urlParametersKey } = useMemo(() => {
    const placeholderNames = Array.from(activeRequest.url.matchAll(/\/(:[^/]+)/g)).map(
      (m) => m[1] ?? '',
    );
    const nonEmptyParameters = activeRequest.urlParameters.filter((p) => p.name || p.value);
    const items: Pair[] = [...nonEmptyParameters];
    for (const name of placeholderNames) {
      const item = items.find((p) => p.name === name);
      if (item) {
        item.readOnlyName = true;
      } else {
        items.push({ name, value: '', enabled: true, readOnlyName: true, id: generateId() });
      }
    }
    return { urlParameterPairs: items, urlParametersKey: placeholderNames.join(',') };
  }, [activeRequest.url, activeRequest.urlParameters]);

  const tabs = useMemo<TabItem[]>(() => {
    return [
      {
        value: TAB_MESSAGE,
        label: 'Message',
      } as TabItem,
      {
        value: TAB_PARAMS,
        rightSlot: <CountBadge count={urlParameterPairs.length} />,
        label: 'Params',
      },
      ...headersTab,
      ...authTab,
      {
        value: TAB_DESCRIPTION,
        label: 'Info',
      },
    ];
  }, [authTab, headersTab, urlParameterPairs.length]);

  const { activeResponse } = usePinnedHttpResponse(activeRequestId);
  const { mutate: cancelResponse } = useCancelHttpResponse(activeResponse?.id ?? null);
  const connection = useAtomValue(activeWebsocketConnectionAtom);

  const autocompleteUrls = useAtomValue(memoNotActiveRequestUrlsAtom);

  const autocomplete: GenericCompletionConfig = useMemo(
    () => ({
      minMatch: 3,
      options:
        autocompleteUrls.length > 0
          ? autocompleteUrls
          : [
              { label: 'http://', type: 'constant' },
              { label: 'https://', type: 'constant' },
            ],
    }),
    [autocompleteUrls],
  );

  const handleConnect = useCallback(async () => {
    await connectWebsocket({
      requestId: activeRequest.id,
      environmentId: getActiveEnvironment()?.id ?? null,
      cookieJarId: getActiveCookieJar()?.id ?? null,
    });
  }, [activeRequest.id]);

  const handleSend = useCallback(async () => {
    if (connection == null) return;
    await sendWebsocket({
      connectionId: connection?.id,
      environmentId: getActiveEnvironment()?.id ?? null,
    });
  }, [connection]);

  const handleCancel = useCallback(async () => {
    if (connection == null) return;
    await closeWebsocket({ connectionId: connection?.id });
  }, [connection]);

  const handleUrlChange = useCallback(
    (url: string) => patchModel(activeRequest, { url }),
    [activeRequest],
  );

  const handlePaste = useCallback(
    async (e: ClipboardEvent, text: string) => {
      const patch = prepareImportQuerystring(text);
      if (patch != null) {
        e.preventDefault(); // Prevent input onChange

        await patchModel(activeRequest, patch);
        await setActiveTab({
          storageKey: TABS_STORAGE_KEY,
          activeTabKey: activeRequestId,
          value: TAB_PARAMS,
        });

        // Wait for request to update, then refresh the UI
        // TODO: Somehow make this deterministic
        setTimeout(() => {
          forceUrlRefresh();
          forceParamsRefresh();
        }, 100);
      }
    },
    [activeRequest, activeRequestId, forceParamsRefresh, forceUrlRefresh],
  );

  const messageLanguage = languageFromContentType(null, activeRequest.message);

  const isLoading = connection !== null && connection.state !== 'closed';

  return (
    <div
      style={style}
      className={classNames(className, 'h-full grid grid-rows-[auto_minmax(0,1fr)] grid-cols-1')}
    >
      {activeRequest && (
        <>
          <div className="grid grid-cols-[minmax(0,1fr)_auto]">
            <UrlBar
              stateKey={`url.${activeRequest.id}`}
              key={forceUpdateKey + urlKey}
              url={activeRequest.url}
              submitIcon={isLoading ? 'send_horizontal' : 'arrow_up_down'}
              rightSlot={
                isLoading && (
                  <IconButton
                    size="xs"
                    title="Close connection"
                    icon="x"
                    iconColor="secondary"
                    className="w-8 mr-0.5 !h-full"
                    onClick={handleCancel}
                  />
                )
              }
              placeholder="wss://example.com"
              onPasteOverwrite={handlePaste}
              autocomplete={autocomplete}
              onSend={isLoading ? handleSend : handleConnect}
              onCancel={cancelResponse}
              onUrlChange={handleUrlChange}
              forceUpdateKey={forceUpdateKey}
              isLoading={activeResponse != null && activeResponse.state !== 'closed'}
            />
          </div>
          <Tabs
            ref={tabsRef}
            label="Request"
            tabs={tabs}
            tabListClassName="mt-1 !mb-1.5"
            storageKey={TABS_STORAGE_KEY}
            activeTabKey={activeRequestId}
          >
            <TabContent value={TAB_AUTH}>
              <HttpAuthenticationEditor model={activeRequest} />
            </TabContent>
            <TabContent value={TAB_HEADERS}>
              <HeadersEditor
                inheritedHeaders={inheritedHeaders}
                forceUpdateKey={forceUpdateKey}
                headers={activeRequest.headers}
                stateKey={`headers.${activeRequest.id}`}
                onChange={(headers) => patchModel(activeRequest, { headers })}
              />
            </TabContent>
            <TabContent value={TAB_PARAMS}>
              <UrlParametersEditor
                stateKey={`params.${activeRequest.id}`}
                forceUpdateKey={forceUpdateKey + urlParametersKey}
                pairs={urlParameterPairs}
                onChange={(urlParameters) => patchModel(activeRequest, { urlParameters })}
              />
            </TabContent>
            <TabContent value={TAB_MESSAGE}>
              <Editor
                forceUpdateKey={forceUpdateKey}
                autocompleteFunctions
                autocompleteVariables
                placeholder="..."
                heightMode={fullHeight ? 'full' : 'auto'}
                defaultValue={activeRequest.message}
                language={messageLanguage}
                onChange={(message) => patchModel(activeRequest, { message })}
                stateKey={`json.${activeRequest.id}`}
              />
            </TabContent>
            <TabContent value={TAB_DESCRIPTION}>
              <div className="grid grid-rows-[auto_minmax(0,1fr)] h-full">
                <PlainInput
                  label="Request Name"
                  hideLabel
                  forceUpdateKey={forceUpdateKey}
                  defaultValue={activeRequest.name}
                  className="font-sans !text-xl !px-0"
                  containerClassName="border-0"
                  placeholder={resolvedModelName(activeRequest)}
                  onChange={(name) => patchModel(activeRequest, { name })}
                />
                <MarkdownEditor
                  name="request-description"
                  placeholder="Request description"
                  defaultValue={activeRequest.description}
                  stateKey={`description.${activeRequest.id}`}
                  forceUpdateKey={forceUpdateKey}
                  onChange={(description) => patchModel(activeRequest, { description })}
                />
              </div>
            </TabContent>
          </Tabs>
        </>
      )}
    </div>
  );
}
