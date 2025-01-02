import type { HttpRequest } from '@yaakapp-internal/models';
import classNames from 'classnames';
import { atom, useAtomValue } from 'jotai';
import type { CSSProperties } from 'react';
import React, { memo, useCallback, useMemo, useState } from 'react';
import { useLocalStorage } from 'react-use';
import { activeRequestIdAtom } from '../hooks/useActiveRequestId';
import { useCancelHttpResponse } from '../hooks/useCancelHttpResponse';
import { useContentTypeFromHeaders } from '../hooks/useContentTypeFromHeaders';
import { grpcRequestsAtom } from '../hooks/useGrpcRequests';
import { httpRequestsAtom } from '../hooks/useHttpRequests';
import { useImportCurl } from '../hooks/useImportCurl';
import { useImportQuerystring } from '../hooks/useImportQuerystring';
import { useIsResponseLoading } from '../hooks/useIsResponseLoading';
import { usePinnedHttpResponse } from '../hooks/usePinnedHttpResponse';
import { useRequestEditor, useRequestEditorEvent } from '../hooks/useRequestEditor';
import { useRequestUpdateKey } from '../hooks/useRequestUpdateKey';
import { useSendAnyHttpRequest } from '../hooks/useSendAnyHttpRequest';
import { useToast } from '../hooks/useToast';
import { useUpdateAnyHttpRequest } from '../hooks/useUpdateAnyHttpRequest';
import { deepEqualAtom } from '../lib/atoms';
import { languageFromContentType } from '../lib/contentType';
import { tryFormatJson } from '../lib/formatters';
import { generateId } from '../lib/generateId';
import {
  AUTH_TYPE_BASIC,
  AUTH_TYPE_BEARER,
  AUTH_TYPE_NONE,
  BODY_TYPE_BINARY,
  BODY_TYPE_FORM_MULTIPART,
  BODY_TYPE_FORM_URLENCODED,
  BODY_TYPE_GRAPHQL,
  BODY_TYPE_JSON,
  BODY_TYPE_NONE,
  BODY_TYPE_OTHER,
  BODY_TYPE_XML,
} from '../lib/model_util';
import { BasicAuth } from './BasicAuth';
import { BearerAuth } from './BearerAuth';
import { BinaryFileEditor } from './BinaryFileEditor';
import { CountBadge } from './core/CountBadge';
import { Editor } from './core/Editor/Editor';
import type {
  GenericCompletionConfig,
  GenericCompletionOption,
} from './core/Editor/genericCompletion';
import { InlineCode } from './core/InlineCode';
import type { Pair } from './core/PairEditor';
import { PlainInput } from './core/PlainInput';
import type { TabItem } from './core/Tabs/Tabs';
import { TabContent, Tabs } from './core/Tabs/Tabs';
import { EmptyStateText } from './EmptyStateText';
import { FormMultipartEditor } from './FormMultipartEditor';
import { FormUrlencodedEditor } from './FormUrlencodedEditor';
import { GraphQLEditor } from './GraphQLEditor';
import { HeadersEditor } from './HeadersEditor';
import { MarkdownEditor } from './MarkdownEditor';
import { UrlBar } from './UrlBar';
import { UrlParametersEditor } from './UrlParameterEditor';

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
  const requests = [...get(httpRequestsAtom), ...get(grpcRequestsAtom)];
  return requests
    .filter((r) => r.id !== activeRequestId)
    .map((r): GenericCompletionOption => ({ type: 'constant', label: r.url }));
});

const memoNotActiveRequestUrlsAtom = deepEqualAtom(nonActiveRequestUrlsAtom);

export const RequestPane = memo(function RequestPane({
  style,
  fullHeight,
  className,
  activeRequest,
}: Props) {
  const activeRequestId = activeRequest.id;
  const { mutateAsync: updateRequestAsync, mutate: updateRequest } = useUpdateAnyHttpRequest();
  const [activeTabs, setActiveTabs] = useLocalStorage<Record<string, string>>(
    'requestPaneActiveTabs',
    {},
  );
  const [forceUpdateHeaderEditorKey, setForceUpdateHeaderEditorKey] = useState<number>(0);
  const { updateKey: forceUpdateKey } = useRequestUpdateKey(activeRequest.id ?? null);
  const [{ urlKey }] = useRequestEditor();
  const contentType = useContentTypeFromHeaders(activeRequest.headers);

  const handleContentTypeChange = useCallback(
    async (contentType: string | null) => {
      if (activeRequest == null || activeRequest.model !== 'http_request') {
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
      await updateRequestAsync({ id: activeRequest.id, update: { headers } });

      // Force update header editor so any changed headers are reflected
      setTimeout(() => setForceUpdateHeaderEditorKey((u) => u + 1), 100);
    },
    [activeRequest, updateRequestAsync],
  );

  const toast = useToast();

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
    const n = Array.isArray(activeRequest.body?.form)
      ? activeRequest.body.form.filter((p) => p.name).length
      : 0;
    numParams = n;
  }

  const tabs = useMemo<TabItem[]>(
    () => [
      {
        value: TAB_DESCRIPTION,
        label: 'Info',
      },
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
            { label: 'Other', value: BODY_TYPE_OTHER },
            { type: 'separator', label: 'Other' },
            { label: 'Binary File', value: BODY_TYPE_BINARY },
            { label: 'No Body', shortLabel: 'Body', value: BODY_TYPE_NONE },
          ],
          onChange: async (bodyType) => {
            if (bodyType === activeRequest.bodyType) return;

            const showMethodToast = (newMethod: string) => {
              if (activeRequest.method.toLowerCase() === newMethod.toLowerCase()) return;
              toast.show({
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

            await updateRequestAsync({ id: activeRequestId, update: patch });

            if (newContentType !== undefined) {
              await handleContentTypeChange(newContentType);
            }
          },
        },
      },
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
            { label: 'Basic Auth', shortLabel: 'Basic', value: AUTH_TYPE_BASIC },
            { label: 'Bearer Token', shortLabel: 'Bearer', value: AUTH_TYPE_BEARER },
            { type: 'separator' },
            { label: 'No Authentication', shortLabel: 'Auth', value: AUTH_TYPE_NONE },
          ],
          onChange: async (authenticationType) => {
            let authentication: HttpRequest['authentication'] = activeRequest.authentication;
            if (authenticationType === AUTH_TYPE_BASIC) {
              authentication = {
                username: authentication.username ?? '',
                password: authentication.password ?? '',
              };
            } else if (authenticationType === AUTH_TYPE_BEARER) {
              authentication = {
                token: authentication.token ?? '',
              };
            }
            updateRequest({
              id: activeRequestId,
              update: { authenticationType, authentication },
            });
          },
        },
      },
    ],
    [
      activeRequest.authentication,
      activeRequest.authenticationType,
      activeRequest.bodyType,
      activeRequest.headers,
      activeRequest.method,
      activeRequestId,
      handleContentTypeChange,
      numParams,
      toast,
      updateRequest,
      updateRequestAsync,
      urlParameterPairs.length,
    ],
  );

  const isLoading = useIsResponseLoading(activeRequestId);
  const { mutate: sendRequest } = useSendAnyHttpRequest();
  const { activeResponse } = usePinnedHttpResponse(activeRequestId);
  const { mutate: cancelResponse } = useCancelHttpResponse(activeResponse?.id ?? null);
  const { updateKey } = useRequestUpdateKey(activeRequestId);
  const { mutate: importCurl } = useImportCurl();
  const { mutate: importQuerystring } = useImportQuerystring(activeRequestId);

  const handleBodyChange = useCallback(
    (body: HttpRequest['body']) => updateRequest({ id: activeRequestId, update: { body } }),
    [activeRequestId, updateRequest],
  );

  const handleBodyTextChange = useCallback(
    (text: string) => updateRequest({ id: activeRequestId, update: { body: { text } } }),
    [activeRequestId, updateRequest],
  );

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

  const handlePaste = useCallback(
    (text: string) => {
      if (text.startsWith('curl ')) {
        importCurl({ overwriteRequestId: activeRequestId, command: text });
      } else {
        // Only import query if pasted text contains entire querystring
        importQuerystring(text);
      }
    },
    [activeRequestId, importCurl, importQuerystring],
  );

  const handleSend = useCallback(
    () => sendRequest(activeRequest.id ?? null),
    [activeRequest.id, sendRequest],
  );

  const handleMethodChange = useCallback(
    (method: string) => updateRequest({ id: activeRequestId, update: { method } }),
    [activeRequestId, updateRequest],
  );

  const handleUrlChange = useCallback(
    (url: string) => updateRequest({ id: activeRequestId, update: { url } }),
    [activeRequestId, updateRequest],
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
            method={activeRequest.method}
            placeholder="https://example.com"
            onPasteOverwrite={handlePaste}
            autocomplete={autocomplete}
            onSend={handleSend}
            onCancel={cancelResponse}
            onMethodChange={handleMethodChange}
            onUrlChange={handleUrlChange}
            forceUpdateKey={updateKey}
            isLoading={isLoading}
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
              {activeRequest.authenticationType === AUTH_TYPE_BASIC ? (
                <BasicAuth key={forceUpdateKey} request={activeRequest} />
              ) : activeRequest.authenticationType === AUTH_TYPE_BEARER ? (
                <BearerAuth key={forceUpdateKey} request={activeRequest} />
              ) : (
                <EmptyStateText>
                  No Authentication {activeRequest.authenticationType}
                </EmptyStateText>
              )}
            </TabContent>
            <TabContent value={TAB_HEADERS}>
              <HeadersEditor
                forceUpdateKey={`${forceUpdateHeaderEditorKey}::${forceUpdateKey}`}
                request={activeRequest}
                onChange={(headers) => updateRequest({ id: activeRequestId, update: { headers } })}
              />
            </TabContent>
            <TabContent value={TAB_PARAMS}>
              <UrlParametersEditor
                stateKey={`params.${activeRequest.id}`}
                forceUpdateKey={forceUpdateKey + urlParametersKey}
                pairs={urlParameterPairs}
                onChange={(urlParameters) =>
                  updateRequest({ id: activeRequestId, update: { urlParameters } })
                }
              />
            </TabContent>
            <TabContent value={TAB_BODY}>
              {activeRequest.bodyType === BODY_TYPE_JSON ? (
                <Editor
                  forceUpdateKey={forceUpdateKey}
                  useTemplating
                  autocompleteVariables
                  placeholder="..."
                  heightMode={fullHeight ? 'full' : 'auto'}
                  defaultValue={`${activeRequest.body?.text ?? ''}`}
                  language="json"
                  onChange={handleBodyTextChange}
                  format={tryFormatJson}
                  stateKey={`json.${activeRequest.id}`}
                />
              ) : activeRequest.bodyType === BODY_TYPE_XML ? (
                <Editor
                  forceUpdateKey={forceUpdateKey}
                  useTemplating
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
                  onChange={(body) => updateRequest({ id: activeRequestId, update: { body } })}
                  onChangeContentType={handleContentTypeChange}
                />
              ) : typeof activeRequest.bodyType === 'string' ? (
                <Editor
                  forceUpdateKey={forceUpdateKey}
                  useTemplating
                  autocompleteVariables
                  language={languageFromContentType(contentType)}
                  placeholder="..."
                  heightMode={fullHeight ? 'full' : 'auto'}
                  defaultValue={`${activeRequest.body?.text ?? ''}`}
                  onChange={handleBodyTextChange}
                  stateKey={`other.${activeRequest.id}`}
                />
              ) : (
                <EmptyStateText>Empty Body</EmptyStateText>
              )}
            </TabContent>
            <TabContent value={TAB_DESCRIPTION}>
              <div className="grid grid-rows-[auto_minmax(0,1fr)] h-full">
                <PlainInput
                  label="Request Name"
                  hideLabel
                  defaultValue={activeRequest.name}
                  className="font-sans !text-xl !px-0"
                  containerClassName="border-0"
                  placeholder={activeRequest.id}
                  onChange={(name) => updateRequest({ id: activeRequestId, update: { name } })}
                />
                <MarkdownEditor
                  name="request-description"
                  placeholder="Request description"
                  defaultValue={activeRequest.description}
                  stateKey={`description.${activeRequest.id}`}
                  onChange={(description) =>
                    updateRequest({ id: activeRequestId, update: { description } })
                  }
                />
              </div>
            </TabContent>
          </Tabs>
        </>
      )}
    </div>
  );
});
