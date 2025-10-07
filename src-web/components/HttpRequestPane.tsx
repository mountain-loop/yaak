import type { HttpRequest } from '@yaakapp-internal/models';
import { patchModel } from '@yaakapp-internal/models';
import type { GenericCompletionOption } from '@yaakapp-internal/plugins';
import classNames from 'classnames';
import { atom, useAtomValue } from 'jotai';
import type { CSSProperties } from 'react';
import React, { useCallback, useMemo, useState } from 'react';
import { activeRequestIdAtom } from '../hooks/useActiveRequestId';
import { allRequestsAtom } from '../hooks/useAllRequests';
import { useAuthTab } from '../hooks/useAuthTab';
import { useCancelHttpResponse } from '../hooks/useCancelHttpResponse';
import { useHeadersTab } from '../hooks/useHeadersTab';
import { useImportCurl } from '../hooks/useImportCurl';
import { useInheritedHeaders } from '../hooks/useInheritedHeaders';
import { useKeyValue } from '../hooks/useKeyValue';
import { usePinnedHttpResponse } from '../hooks/usePinnedHttpResponse';
import { useRequestEditor, useRequestEditorEvent } from '../hooks/useRequestEditor';
import { useRequestUpdateKey } from '../hooks/useRequestUpdateKey';
import { useSendAnyHttpRequest } from '../hooks/useSendAnyHttpRequest';
import { deepEqualAtom } from '../lib/atoms';
import { languageFromContentType } from '../lib/contentType';
import { generateId } from '../lib/generateId';
import {
  BODY_TYPE_BINARY,
  BODY_TYPE_FORM_MULTIPART,
  BODY_TYPE_FORM_URLENCODED,
  BODY_TYPE_GRAPHQL,
  BODY_TYPE_JSON,
  BODY_TYPE_NONE,
  BODY_TYPE_OTHER,
  BODY_TYPE_XML,
  getContentTypeFromHeaders,
} from '../lib/model_util';
import { prepareImportQuerystring } from '../lib/prepareImportQuerystring';
import { resolvedModelName } from '../lib/resolvedModelName';
import { showToast } from '../lib/toast';
import { BinaryFileEditor } from './BinaryFileEditor';
import { ConfirmLargeRequestBody } from './ConfirmLargeRequestBody';
import { CountBadge } from './core/CountBadge';
import { Editor } from './core/Editor/Editor';
import type { GenericCompletionConfig } from './core/Editor/genericCompletion';
import { InlineCode } from './core/InlineCode';
import type { Pair } from './core/PairEditor';
import { PlainInput } from './core/PlainInput';
import { TabContent, Tabs } from './core/Tabs/Tabs';
import type { TabItem } from './core/Tabs/Tabs';
import { EmptyStateText } from './EmptyStateText';
import { FormMultipartEditor } from './FormMultipartEditor';
import { FormUrlencodedEditor } from './FormUrlencodedEditor';
import { HeadersEditor } from './HeadersEditor';
import { HttpAuthenticationEditor } from './HttpAuthenticationEditor';
import { MarkdownEditor } from './MarkdownEditor';
import { RequestMethodDropdown } from './RequestMethodDropdown';
import { UrlBar } from './UrlBar';
import { UrlParametersEditor } from './UrlParameterEditor';
import { GraphQLEditor } from './graphql/GraphQLEditor';

interface Props {
  style: CSSProperties;
  fullHeight: boolean;
  className?: string;
  activeRequest: HttpRequest;
}

const TAB_BODY = 'body';
const TAB_PARAMS = 'params';
const TAB_HEADERS = 'headers';
const TAB_AUTH = 'auth';
const TAB_DESCRIPTION = 'description';

const nonActiveRequestUrlsAtom = atom((get) => {
  const activeRequestId = get(activeRequestIdAtom);
  const requests = get(allRequestsAtom);
  return requests
    .filter((r) => r.id !== activeRequestId)
    .map((r): GenericCompletionOption => ({ type: 'constant', label: r.url }));
});

const memoNotActiveRequestUrlsAtom = deepEqualAtom(nonActiveRequestUrlsAtom);

export function HttpRequestPane({ style, fullHeight, className, activeRequest }: Props) {
  const activeRequestId = activeRequest.id;
  const { value: activeTabs, set: setActiveTabs } = useKeyValue<Record<string, string>>({
    namespace: 'no_sync',
    key: 'httpRequestActiveTabs',
    fallback: {},
  });
  const [forceUpdateHeaderEditorKey, setForceUpdateHeaderEditorKey] = useState<number>(0);
  const forceUpdateKey = useRequestUpdateKey(activeRequest.id ?? null);
  const [{ urlKey }, { focusParamsTab, forceUrlRefresh, forceParamsRefresh }] = useRequestEditor();
  const contentType = getContentTypeFromHeaders(activeRequest.headers);
  const authTab = useAuthTab(TAB_AUTH, activeRequest);
  const headersTab = useHeadersTab(TAB_HEADERS, activeRequest);
  const inheritedHeaders = useInheritedHeaders(activeRequest);

  const handleContentTypeChange = useCallback(
    async (contentType: string | null, patch: Partial<Omit<HttpRequest, 'headers'>> = {}) => {
      if (activeRequest == null) {
        console.error('Failed to get active request to update', activeRequest);
        return;
      }

      const headers = activeRequest.headers.filter((h) => h.name.toLowerCase() !== 'content-type');

      if (contentType != null) {
        headers.push({
          name: 'Content-Type',
          value: contentType,
          enabled: true,
          id: generateId(),
        });
      }
      await patchModel(activeRequest, { ...patch, headers });

      // Force update header editor so any changed headers are reflected
      setTimeout(() => setForceUpdateHeaderEditorKey((u) => u + 1), 100);
    },
    [activeRequest],
  );

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

  let numParams = 0;
  if (
    activeRequest.bodyType === BODY_TYPE_FORM_URLENCODED ||
    activeRequest.bodyType === BODY_TYPE_FORM_MULTIPART
  ) {
    numParams = Array.isArray(activeRequest.body?.form)
      ? activeRequest.body.form.filter((p) => p.name).length
      : 0;
  }

  const tabs = useMemo<TabItem[]>(
    () => [
      {
        value: TAB_BODY,
        rightSlot: numParams > 0 ? <CountBadge count={numParams} /> : null,
        options: {
          value: activeRequest.bodyType,
          items: [
            { type: 'separator', label: 'Form Data' },
            { label: 'Url Encoded', value: BODY_TYPE_FORM_URLENCODED },
            { label: 'Multi-Part', value: BODY_TYPE_FORM_MULTIPART },
            { type: 'separator', label: 'Text Content' },
            { label: 'GraphQL', value: BODY_TYPE_GRAPHQL },
            { label: 'JSON', value: BODY_TYPE_JSON },
            { label: 'XML', value: BODY_TYPE_XML },
            {
              label: 'Other',
              value: BODY_TYPE_OTHER,
              shortLabel: nameOfContentTypeOr(contentType, 'Other'),
            },
            { type: 'separator', label: 'Other' },
            { label: 'Binary File', value: BODY_TYPE_BINARY },
            { label: 'No Body', shortLabel: 'Body', value: BODY_TYPE_NONE },
          ],
          onChange: async (bodyType) => {
            if (bodyType === activeRequest.bodyType) return;

            const showMethodToast = (newMethod: string) => {
              if (activeRequest.method.toLowerCase() === newMethod.toLowerCase()) return;
              showToast({
                id: 'switched-method',
                message: (
                  <>
                    Request method switched to <InlineCode>POST</InlineCode>
                  </>
                ),
              });
            };

            const patch: Partial<HttpRequest> = { bodyType };
            let newContentType: string | null | undefined;
            if (bodyType === BODY_TYPE_NONE) {
              newContentType = null;
            } else if (
              bodyType === BODY_TYPE_FORM_URLENCODED ||
              bodyType === BODY_TYPE_FORM_MULTIPART ||
              bodyType === BODY_TYPE_JSON ||
              bodyType === BODY_TYPE_OTHER ||
              bodyType === BODY_TYPE_XML
            ) {
              const isDefaultishRequest =
                activeRequest.bodyType === BODY_TYPE_NONE &&
                activeRequest.method.toLowerCase() === 'get';
              const requiresPost = bodyType === BODY_TYPE_FORM_MULTIPART;
              if (isDefaultishRequest || requiresPost) {
                patch.method = 'POST';
                showMethodToast(patch.method);
              }
              newContentType = bodyType === BODY_TYPE_OTHER ? 'text/plain' : bodyType;
            } else if (bodyType == BODY_TYPE_GRAPHQL) {
              patch.method = 'POST';
              newContentType = 'application/json';
              showMethodToast(patch.method);
            }

            if (newContentType !== undefined) {
              await handleContentTypeChange(newContentType, patch);
            } else {
              await patchModel(activeRequest, patch);
            }
          },
        },
      },
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
    ],
    [
      activeRequest,
      authTab,
      contentType,
      handleContentTypeChange,
      headersTab,
      numParams,
      urlParameterPairs.length,
    ],
  );

  const { mutate: sendRequest } = useSendAnyHttpRequest();
  const { activeResponse } = usePinnedHttpResponse(activeRequestId);
  const { mutate: cancelResponse } = useCancelHttpResponse(activeResponse?.id ?? null);
  const updateKey = useRequestUpdateKey(activeRequestId);
  const { mutate: importCurl } = useImportCurl();

  const handleBodyChange = useCallback(
    (body: HttpRequest['body']) => patchModel(activeRequest, { body }),
    [activeRequest],
  );

  const handleBodyTextChange = useCallback(
    (text: string) => patchModel(activeRequest, { body: { text } }),
    [activeRequest],
  );

  const activeTab = activeTabs?.[activeRequestId];
  const setActiveTab = useCallback(
    async (tab: string) => {
      await setActiveTabs((r) => ({ ...r, [activeRequest.id]: tab }));
    },
    [activeRequest.id, setActiveTabs],
  );

  useRequestEditorEvent('request_pane.focus_tab', async () => {
    await setActiveTab(TAB_PARAMS);
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

  const handlePaste = useCallback(
    async (e: ClipboardEvent, text: string) => {
      if (text.startsWith('curl ')) {
        importCurl({ overwriteRequestId: activeRequestId, command: text });
      } else {
        const patch = prepareImportQuerystring(text);
        if (patch != null) {
          e.preventDefault(); // Prevent input onChange

          await patchModel(activeRequest, patch);
          focusParamsTab();

          // Wait for request to update, then refresh the UI
          // TODO: Somehow make this deterministic
          setTimeout(() => {
            forceUrlRefresh();
            forceParamsRefresh();
          }, 100);
        }
      }
    },
    [
      activeRequest,
      activeRequestId,
      focusParamsTab,
      forceParamsRefresh,
      forceUrlRefresh,
      importCurl,
    ],
  );
  const handleSend = useCallback(
    () => sendRequest(activeRequest.id ?? null),
    [activeRequest.id, sendRequest],
  );

  const handleUrlChange = useCallback(
    (url: string) => patchModel(activeRequest, { url }),
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
            placeholder="https://example.com"
            onPasteOverwrite={handlePaste}
            autocomplete={autocomplete}
            onSend={handleSend}
            onCancel={cancelResponse}
            onUrlChange={handleUrlChange}
            leftSlot={
              <div className="py-0.5">
                <RequestMethodDropdown request={activeRequest} className="ml-0.5 !h-full" />
              </div>
            }
            forceUpdateKey={updateKey}
            isLoading={activeResponse != null && activeResponse.state !== 'closed'}
          />
          <Tabs
            key={activeRequest.id} // Freshen tabs on request change
            value={activeTab}
            label="Request"
            onChangeValue={setActiveTab}
            tabs={tabs}
            tabListClassName="mt-1 mb-1.5"
          >
            <TabContent value={TAB_AUTH}>
              <HttpAuthenticationEditor model={activeRequest} />
            </TabContent>
            <TabContent value={TAB_HEADERS}>
              <HeadersEditor
                inheritedHeaders={inheritedHeaders}
                forceUpdateKey={`${forceUpdateHeaderEditorKey}::${forceUpdateKey}`}
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
            <TabContent value={TAB_BODY}>
              <ConfirmLargeRequestBody request={activeRequest}>
                {activeRequest.bodyType === BODY_TYPE_JSON ? (
                  <Editor
                    forceUpdateKey={forceUpdateKey}
                    autocompleteFunctions
                    autocompleteVariables
                    placeholder="..."
                    heightMode={fullHeight ? 'full' : 'auto'}
                    defaultValue={`${activeRequest.body?.text ?? ''}`}
                    language="json"
                    onChange={handleBodyTextChange}
                    stateKey={`json.${activeRequest.id}`}
                  />
                ) : activeRequest.bodyType === BODY_TYPE_XML ? (
                  <Editor
                    forceUpdateKey={forceUpdateKey}
                    autocompleteFunctions
                    autocompleteVariables
                    placeholder="..."
                    heightMode={fullHeight ? 'full' : 'auto'}
                    defaultValue={`${activeRequest.body?.text ?? ''}`}
                    language="xml"
                    onChange={handleBodyTextChange}
                    stateKey={`xml.${activeRequest.id}`}
                  />
                ) : activeRequest.bodyType === BODY_TYPE_GRAPHQL ? (
                  <GraphQLEditor
                    forceUpdateKey={forceUpdateKey}
                    baseRequest={activeRequest}
                    request={activeRequest}
                    onChange={handleBodyChange}
                  />
                ) : activeRequest.bodyType === BODY_TYPE_FORM_URLENCODED ? (
                  <FormUrlencodedEditor
                    forceUpdateKey={forceUpdateKey}
                    request={activeRequest}
                    onChange={handleBodyChange}
                  />
                ) : activeRequest.bodyType === BODY_TYPE_FORM_MULTIPART ? (
                  <FormMultipartEditor
                    forceUpdateKey={forceUpdateKey}
                    request={activeRequest}
                    onChange={handleBodyChange}
                  />
                ) : activeRequest.bodyType === BODY_TYPE_BINARY ? (
                  <BinaryFileEditor
                    requestId={activeRequest.id}
                    contentType={contentType}
                    body={activeRequest.body}
                    onChange={(body) => patchModel(activeRequest, { body })}
                    onChangeContentType={handleContentTypeChange}
                  />
                ) : typeof activeRequest.bodyType === 'string' ? (
                  <Editor
                    forceUpdateKey={forceUpdateKey}
                    autocompleteFunctions
                    autocompleteVariables
                    language={languageFromContentType(contentType)}
                    placeholder="..."
                    heightMode={fullHeight ? 'full' : 'auto'}
                    defaultValue={`${activeRequest.body?.text ?? ''}`}
                    onChange={handleBodyTextChange}
                    stateKey={`other.${activeRequest.id}`}
                  />
                ) : (
                  <EmptyStateText>No Body</EmptyStateText>
                )}
              </ConfirmLargeRequestBody>
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
                  placeholder={resolvedModelName(activeRequest)}
                  onChange={(name) => patchModel(activeRequest, { name })}
                />
                <MarkdownEditor
                  name="request-description"
                  placeholder="Request description"
                  defaultValue={activeRequest.description}
                  stateKey={`description.${activeRequest.id}`}
                  forceUpdateKey={updateKey}
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

function nameOfContentTypeOr(contentType: string | null, fallback: string) {
  const language = languageFromContentType(contentType);
  if (language === 'markdown') {
    return 'Markdown';
  }
  return fallback;
}
