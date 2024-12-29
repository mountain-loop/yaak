import type { HttpRequest } from '@yaakapp-internal/models';
import classNames from 'classnames';
import type { CSSProperties } from 'react';
import React, { memo, useCallback, useMemo, useState } from 'react';
import { useLocalStorage } from 'react-use';
import { useCancelHttpResponse } from '../hooks/useCancelHttpResponse';
import { useContentTypeFromHeaders } from '../hooks/useContentTypeFromHeaders';
import { useImportCurl } from '../hooks/useImportCurl';
import { useImportQuerystring } from '../hooks/useImportQuerystring';
import { useIsResponseLoading } from '../hooks/useIsResponseLoading';
import { usePinnedHttpResponse } from '../hooks/usePinnedHttpResponse';
import { useRequestEditor, useRequestEditorEvent } from '../hooks/useRequestEditor';
import { useRequests } from '../hooks/useRequests';
import { useRequestUpdateKey } from '../hooks/useRequestUpdateKey';
import { useSendAnyHttpRequest } from '../hooks/useSendAnyHttpRequest';
import { useToast } from '../hooks/useToast';
import { useUpdateAnyHttpRequest } from '../hooks/useUpdateAnyHttpRequest';
import { languageFromContentType } from '../lib/contentType';
import { tryFormatJson } from '../lib/formatters';
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

export const RequestPane = memo(function RequestPane({
  style,
  fullHeight,
  className,
  activeRequest,
}: Props) {
  const requests = useRequests();
  const activeRequestId = activeRequest.id;
  const updateRequest = useUpdateAnyHttpRequest();
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
      const headers = activeRequest.headers.filter((h) => h.name.toLowerCase() !== 'content-type');

      if (contentType != null) {
        headers.push({
          name: 'Content-Type',
          value: contentType,
          enabled: true,
        });
      }
      await updateRequest.mutateAsync({ id: activeRequestId, update: { headers } });

      // Force update header editor so any changed headers are reflected
      setTimeout(() => setForceUpdateHeaderEditorKey((u) => u + 1), 100);
    },
    [activeRequest.headers, activeRequestId, updateRequest],
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
        items.push({ name, value: '', enabled: true, readOnlyName: true });
      }
    }
    return { urlParameterPairs: items, urlParametersKey: placeholderNames.join(',') };
  }, [activeRequest.url, activeRequest.urlParameters]);

  const tabs: TabItem[] = useMemo(
    () => [
      {
        value: TAB_DESCRIPTION,
        label: (
          <div className="flex items-center">
            Info
            {activeRequest.description && <CountBadge count={true} />}
          </div>
        ),
      },
      {
        value: TAB_BODY,
        options: {
          value: activeRequest.bodyType,
          items: [
            { type: 'separator', label: 'Form Data' },
            {
              label: (
                <>
                  Url Encoded
                  <CountBadge
                    count={'form' in activeRequest.body && activeRequest.body.form.length}
                  />
                </>
              ),
              value: BODY_TYPE_FORM_URLENCODED,
            },
            {
              label: (
                <>
                  Url Encoded
                  <CountBadge
                    count={'form' in activeRequest.body && activeRequest.body.form.length}
                  />
                </>
              ),
              value: BODY_TYPE_FORM_MULTIPART,
            },
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

            await updateRequest.mutateAsync({ id: activeRequestId, update: patch });

            if (newContentType !== undefined) {
              await handleContentTypeChange(newContentType);
            }
          },
        },
      },
      {
        value: TAB_PARAMS,
        label: (
          <div className="flex items-center">
            Params
            <CountBadge count={urlParameterPairs.length} />
          </div>
        ),
      },
      {
        value: TAB_HEADERS,
        label: (
          <div className="flex items-center">
            Headers
            <CountBadge count={activeRequest.headers.filter((h) => h.name).length} />
          </div>
        ),
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
            await updateRequest.mutateAsync({
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
      activeRequest.body,
      activeRequest.bodyType,
      activeRequest.description,
      activeRequest.headers,
      activeRequest.method,
      activeRequestId,
      handleContentTypeChange,
      toast,
      updateRequest,
      urlParameterPairs.length,
    ],
  );

  const sendRequest = useSendAnyHttpRequest();
  const { activeResponse } = usePinnedHttpResponse(activeRequest);
  const cancelResponse = useCancelHttpResponse(activeResponse?.id ?? null);
  const isLoading = useIsResponseLoading(activeRequestId);
  const { updateKey } = useRequestUpdateKey(activeRequestId);
  const importCurl = useImportCurl();
  const importQuerystring = useImportQuerystring(activeRequestId);

  const handleBodyChange = useCallback(
    (body: HttpRequest['body']) => updateRequest.mutate({ id: activeRequestId, update: { body } }),
    [activeRequestId, updateRequest],
  );

  const handleBodyTextChange = useCallback(
    (text: string) => updateRequest.mutate({ id: activeRequestId, update: { body: { text } } }),
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

  const autocomplete: GenericCompletionConfig = {
    minMatch: 3,
    options:
      requests.length > 0
        ? [
            ...requests
              .filter((r) => r.id !== activeRequestId)
              .map((r): GenericCompletionOption => ({ type: 'constant', label: r.url })),
          ]
        : [
            { label: 'http://', type: 'constant' },
            { label: 'https://', type: 'constant' },
          ],
  };

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
            onPasteOverwrite={(text) => {
              if (text.startsWith('curl ')) {
                importCurl.mutate({ overwriteRequestId: activeRequestId, command: text });
              } else {
                // Only import query if pasted text contains entire querystring
                importQuerystring.mutate(text);
              }
            }}
            autocomplete={autocomplete}
            onSend={() => sendRequest.mutateAsync(activeRequest.id ?? null)}
            onCancel={cancelResponse.mutate}
            onMethodChange={(method) =>
              updateRequest.mutate({ id: activeRequestId, update: { method } })
            }
            onUrlChange={(url: string) =>
              updateRequest.mutate({ id: activeRequestId, update: { url } })
            }
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
                onChange={(headers) =>
                  updateRequest.mutate({ id: activeRequestId, update: { headers } })
                }
              />
            </TabContent>
            <TabContent value={TAB_PARAMS}>
              <UrlParametersEditor
                stateKey={`params.${activeRequest.id}`}
                forceUpdateKey={forceUpdateKey + urlParametersKey}
                pairs={urlParameterPairs}
                onChange={(urlParameters) =>
                  updateRequest.mutate({ id: activeRequestId, update: { urlParameters } })
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
                  onChange={(body) =>
                    updateRequest.mutate({ id: activeRequestId, update: { body } })
                  }
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
                  onChange={(name) =>
                    updateRequest.mutate({ id: activeRequestId, update: { name } })
                  }
                />
                <MarkdownEditor
                  name="request-description"
                  placeholder="Request description"
                  defaultValue={activeRequest.description}
                  stateKey={`description.${activeRequest.id}`}
                  onChange={(description) =>
                    updateRequest.mutate({ id: activeRequestId, update: { description } })
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
