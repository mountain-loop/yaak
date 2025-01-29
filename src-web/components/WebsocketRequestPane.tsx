import type { HttpRequest, WebsocketMessageType, WebsocketRequest } from '@yaakapp-internal/models';
import type { GenericCompletionOption } from '@yaakapp-internal/plugins';
import { connectWebsocket } from '@yaakapp-internal/ws';
import classNames from 'classnames';
import { atom, useAtom, useAtomValue } from 'jotai';
import { atomWithStorage } from 'jotai/utils';
import type { CSSProperties } from 'react';
import React, { useCallback, useMemo } from 'react';
import { upsertWebsocketRequest } from '../commands/upsertWebsocketRequest';
import { getActiveCookieJar } from '../hooks/useActiveCookieJar';
import { getActiveEnvironment } from '../hooks/useActiveEnvironment';
import { activeRequestIdAtom } from '../hooks/useActiveRequestId';
import { useCancelHttpResponse } from '../hooks/useCancelHttpResponse';
import { useHttpAuthenticationSummaries } from '../hooks/useHttpAuthentication';
import { useImportQuerystring } from '../hooks/useImportQuerystring';
import { usePinnedHttpResponse } from '../hooks/usePinnedHttpResponse';
import { useRequestEditor, useRequestEditorEvent } from '../hooks/useRequestEditor';
import { requestsAtom } from '../hooks/useRequests';
import { useRequestUpdateKey } from '../hooks/useRequestUpdateKey';
import { deepEqualAtom } from '../lib/atoms';
import { fallbackRequestName } from '../lib/fallbackRequestName';
import { generateId } from '../lib/generateId';
import { CountBadge } from './core/CountBadge';
import { Editor } from './core/Editor/Editor';
import type { GenericCompletionConfig } from './core/Editor/genericCompletion';
import type { Pair } from './core/PairEditor';
import { PlainInput } from './core/PlainInput';
import type { RadioDropdownProps } from './core/RadioDropdown';
import type { TabItem } from './core/Tabs/Tabs';
import { TabContent, Tabs } from './core/Tabs/Tabs';
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

const tabsAtom = atomWithStorage<Record<string, string>>('requestPaneActiveTabs', {});

const nonActiveRequestUrlsAtom = atom((get) => {
  const activeRequestId = get(activeRequestIdAtom);
  const requests = get(requestsAtom);
  return requests
    .filter((r) => r.id !== activeRequestId)
    .map((r): GenericCompletionOption => ({ type: 'constant', label: r.url }));
});

const memoNotActiveRequestUrlsAtom = deepEqualAtom(nonActiveRequestUrlsAtom);

export function WebsocketRequestPane({ style, fullHeight, className, activeRequest }: Props) {
  const activeRequestId = activeRequest.id;
  const [activeTabs, setActiveTabs] = useAtom(tabsAtom);
  const { updateKey: forceUpdateKey } = useRequestUpdateKey(activeRequest.id ?? null);
  const [{ urlKey }] = useRequestEditor();
  const authentication = useHttpAuthenticationSummaries();

  const { urlParameterPairs, urlParametersKey } = useMemo(() => {
    const placeholderNames = Array.from(activeRequest.url.matchAll(/\/(:[^/]+)/g)).map(
      (m) => m[1] ?? '',
    );
    const nonEmptyParameters = activeRequest.urlParameters.filter((p) => p.name || p.value);
    const items: Pair[] = [...nonEmptyParameters];
    for (const name of placeholderNames) {
      const index = items.findIndex((p) => p.name === name);
      if (index >= 0) {
        items[index]!.readOnlyName = true;
      } else {
        items.push({ name, value: '', enabled: true, readOnlyName: true, id: generateId() });
      }
    }
    return { urlParameterPairs: items, urlParametersKey: placeholderNames.join(',') };
  }, [activeRequest.url, activeRequest.urlParameters]);

  const tabs = useMemo<TabItem[]>(() => {
    const options: Omit<RadioDropdownProps<WebsocketMessageType>, 'children'> = {
      value: activeRequest.messageType ?? 'text',
      items: [
        { label: 'Text', value: 'text' },
        { label: 'Binary', value: 'binary' },
      ],
      onChange: async (messageType) => {
        if (messageType === activeRequest.messageType) return;
        upsertWebsocketRequest.mutate({ ...activeRequest, messageType });
      },
    };
    return [
      {
        value: TAB_MESSAGE,
        options,
      } as TabItem,
      {
        value: TAB_PARAMS,
        rightSlot: <CountBadge count={urlParameterPairs.length} />,
        label: 'Params',
      },
      {
        value: TAB_HEADERS,
        label: 'Headers',
        rightSlot: <CountBadge count={activeRequest.headers.filter((h) => h.name).length} />,
      },
      {
        value: TAB_AUTH,
        label: 'Auth',
        options: {
          value: activeRequest.authenticationType,
          items: [
            ...authentication.map((a) => ({
              label: a.label || 'UNKNOWN',
              shortLabel: a.shortLabel,
              value: a.name,
            })),
            { type: 'separator' },
            { label: 'No Authentication', shortLabel: 'Auth', value: null },
          ],
          onChange: async (authenticationType) => {
            let authentication: HttpRequest['authentication'] = activeRequest.authentication;
            if (activeRequest.authenticationType !== authenticationType) {
              authentication = {
                // Reset auth if changing types
              };
            }
            upsertWebsocketRequest.mutate({
              ...activeRequest,
              authenticationType,
              authentication,
            });
          },
        },
      },
      {
        value: TAB_DESCRIPTION,
        label: 'Info',
      },
    ];
  }, [activeRequest, authentication, urlParameterPairs.length]);

  const { activeResponse } = usePinnedHttpResponse(activeRequestId);
  const { mutate: cancelResponse } = useCancelHttpResponse(activeResponse?.id ?? null);
  const { updateKey } = useRequestUpdateKey(activeRequestId);
  const { mutate: importQuerystring } = useImportQuerystring(activeRequestId);

  const activeTab = activeTabs?.[activeRequestId];
  const setActiveTab = useCallback(
    (tab: string) => {
      setActiveTabs((r) => ({ ...r, [activeRequest.id]: tab }));
    },
    [activeRequest.id, setActiveTabs],
  );

  useRequestEditorEvent('request_pane.focus_tab', () => {
    setActiveTab(TAB_PARAMS);
  });

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

  const handleSend = useCallback(async () => {
    const connection = await connectWebsocket({
      requestId: activeRequest.id,
      environmentId: getActiveEnvironment()?.id ?? null,
      cookieJarId: getActiveCookieJar()?.id ?? null,
    });
    console.log('CONNECTION', connection);
  }, [activeRequest.id]);

  const handleUrlChange = useCallback(
    (url: string) => upsertWebsocketRequest.mutate({ ...activeRequest, url }),
    [activeRequest],
  );

  return (
    <div
      style={style}
      className={classNames(className, 'h-full grid grid-rows-[auto_minmax(0,1fr)] grid-cols-1')}
    >
      {activeRequest && (
        <>
          <UrlBar
            stateKey={`url.${activeRequest.id}`}
            key={forceUpdateKey + urlKey}
            url={activeRequest.url}
            placeholder="wss://example.com"
            onPasteOverwrite={importQuerystring}
            autocomplete={autocomplete}
            onSend={handleSend}
            onCancel={cancelResponse}
            onUrlChange={handleUrlChange}
            forceUpdateKey={updateKey}
            isLoading={activeResponse != null && activeResponse.state !== 'closed'}
            method={null}
          />
          <Tabs
            key={activeRequest.id} // Freshen tabs on request change
            value={activeTab}
            label="Request"
            onChangeValue={setActiveTab}
            tabs={tabs}
            tabListClassName="mt-2 !mb-1.5"
          >
            <TabContent value={TAB_AUTH}>
              <HttpAuthenticationEditor request={activeRequest} />
            </TabContent>
            <TabContent value={TAB_HEADERS}>
              <HeadersEditor
                forceUpdateKey={forceUpdateKey}
                headers={activeRequest.headers}
                stateKey={`headers.${activeRequest.id}`}
                onChange={(headers) => upsertWebsocketRequest.mutate({ ...activeRequest, headers })}
              />
            </TabContent>
            <TabContent value={TAB_PARAMS}>
              <UrlParametersEditor
                stateKey={`params.${activeRequest.id}`}
                forceUpdateKey={forceUpdateKey + urlParametersKey}
                pairs={urlParameterPairs}
                onChange={(urlParameters) =>
                  upsertWebsocketRequest.mutate({ ...activeRequest, urlParameters })
                }
              />
            </TabContent>
            <TabContent value={TAB_MESSAGE}>
              {activeRequest.messageType === 'text' ? (
                <Editor
                  forceUpdateKey={forceUpdateKey}
                  useTemplating
                  autocompleteVariables
                  placeholder="..."
                  heightMode={fullHeight ? 'full' : 'auto'}
                  defaultValue={new TextDecoder('utf-8', { fatal: true }).decode(
                    new Uint8Array(activeRequest.message),
                  )}
                  language="json"
                  onChange={(value) =>
                    upsertWebsocketRequest.mutate({
                      ...activeRequest,
                      message: Array.from(new TextEncoder().encode(value)),
                    })
                  }
                  stateKey={`json.${activeRequest.id}`}
                />
              ) : (
                <div>TODO</div>
              )}
            </TabContent>
            <TabContent value={TAB_DESCRIPTION}>
              <div className="grid grid-rows-[auto_minmax(0,1fr)] h-full">
                <PlainInput
                  label="Request Name"
                  hideLabel
                  forceUpdateKey={updateKey}
                  defaultValue={activeRequest.name}
                  className="font-sans !text-xl !px-0"
                  containerClassName="border-0"
                  placeholder={fallbackRequestName(activeRequest)}
                  onChange={(name) => upsertWebsocketRequest.mutate({ ...activeRequest, name })}
                />
                <MarkdownEditor
                  name="request-description"
                  placeholder="Request description"
                  defaultValue={activeRequest.description}
                  stateKey={`description.${activeRequest.id}`}
                  forceUpdateKey={updateKey}
                  onChange={(description) =>
                    upsertWebsocketRequest.mutate({ ...activeRequest, description })
                  }
                />
              </div>
            </TabContent>
          </Tabs>
        </>
      )}
    </div>
  );
}
