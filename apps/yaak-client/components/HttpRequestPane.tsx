import type { HttpRequest } from "@yaakapp-internal/models";
import { getModel, patchModel, patchModelDebounced } from "@yaakapp-internal/models";
import type { GenericCompletionOption } from "@yaakapp-internal/plugins";
import {
  CountBadge,
  type EditablePair,
  type ExtraPaneTab,
  HttpRequestPaneView,
  InlineCode,
  languageFromContentType,
} from "@yaakapp-internal/ui";
import { atom, useAtomValue } from "jotai";
import type { CSSProperties, ReactNode } from "react";
import { lazy, Suspense, useCallback, useMemo, useRef, useState } from "react";
import { importCurl, looksLikeCurl } from "../commands/importCurl";
import { allRequestUrlsAtom } from "../hooks/useAllRequests";
import { useAuthTab } from "../hooks/useAuthTab";
import { useCancelHttpResponse } from "../hooks/useCancelHttpResponse";
import { useHeadersTab } from "../hooks/useHeadersTab";
import { useInheritedHeaders } from "../hooks/useInheritedHeaders";
import { usePinnedHttpResponse } from "../hooks/usePinnedHttpResponse";
import { useRequestEditor, useRequestEditorEvent } from "../hooks/useRequestEditor";
import { useRequestUpdateKey } from "../hooks/useRequestUpdateKey";
import { useSendAnyHttpRequest } from "../hooks/useSendAnyHttpRequest";
import { fireAndForget } from "../lib/fireAndForget";
import { httpRequestToView } from "../lib/httpViews";
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
} from "../lib/model_util";
import { derivePathPlaceholderPairs, renamePathPlaceholder } from "../lib/pathPlaceholders";
import { prepareImportQuerystring } from "../lib/prepareImportQuerystring";
import { convertRequestBody } from "../lib/requestBodyConversion";
import { resolvedModelName } from "../lib/resolvedModelName";
import { showToast } from "../lib/toast";
import { BinaryFileEditor } from "./BinaryFileEditor";
import { ConfirmLargeRequestBody } from "./ConfirmLargeRequestBody";
import type { GenericCompletionConfig } from "./core/Editor/genericCompletion";
import { getUrlCompletionConfig } from "./core/Editor/url/completion";
import { PlainInput } from "./core/PlainInput";
import type { TabItem, TabsRef } from "./core/Tabs/Tabs";
import { setActiveTab } from "./core/Tabs/Tabs";
import { HttpAuthenticationEditor } from "./HttpAuthenticationEditor";
import { MarkdownEditor } from "./MarkdownEditor";
import { countOverriddenSettings, ModelSettingsEditor } from "./ModelSettingsEditor";
import { RequestMethodDropdown } from "./RequestMethodDropdown";
import { UrlParametersEditor } from "./UrlParameterEditor";
import { generateId } from "@yaakapp-internal/lib/generateId";

const GraphQLEditor = lazy(() =>
  import("./graphql/GraphQLEditor").then((m) => ({ default: m.GraphQLEditor })),
);

interface Props {
  style: CSSProperties;
  fullHeight: boolean;
  className?: string;
  activeRequest: HttpRequest;
}

const TAB_BODY = "body";
const TAB_PARAMS = "params";
const TAB_HEADERS = "headers";
const TAB_AUTH = "auth";
const TAB_SETTINGS = "settings";
const TAB_DESCRIPTION = "description";
const TABS_STORAGE_KEY = "http_request_tabs";

// Derived from the identity-stable URL list so this only recomputes when a URL
// actually changes. The active request's own URL is included, but exact matches
// are filtered out at completion time by genericCompletion.
const requestUrlOptionsAtom = atom((get): GenericCompletionOption[] =>
  get(allRequestUrlsAtom).map((url) => ({ type: "constant", label: url })),
);

export function HttpRequestPane({ style, fullHeight, className, activeRequest }: Props) {
  const activeRequestId = activeRequest.id;
  const tabsRef = useRef<TabsRef>(null);
  const [forceUpdateHeaderEditorKey, setForceUpdateHeaderEditorKey] = useState<number>(0);
  const forceUpdateKey = useRequestUpdateKey(activeRequest.id ?? null);
  const [{ urlKey }, { forceUrlRefresh, forceParamsRefresh }] = useRequestEditor();
  const contentType = getContentTypeFromHeaders(activeRequest.headers);
  const authTab = useAuthTab(TAB_AUTH, activeRequest);
  const headersTab = useHeadersTab(TAB_HEADERS, activeRequest);
  const inheritedHeaders = useInheritedHeaders(activeRequest);
  const numSettingsOverrides = countOverriddenSettings(activeRequest);

  // Listen for event to focus the params tab (e.g., when clicking a :param in the URL)
  useRequestEditorEvent(
    "request_pane.focus_tab",
    () => {
      tabsRef.current?.setActiveTab(TAB_PARAMS);
    },
    [],
  );

  const handleContentTypeChange = useCallback(
    async (contentType: string | null, patch: Partial<Omit<HttpRequest, "headers">> = {}) => {
      if (activeRequest == null) {
        console.error("Failed to get active request to update", activeRequest);
        return;
      }

      const headers = activeRequest.headers.filter((h) => h.name.toLowerCase() !== "content-type");

      if (contentType != null) {
        headers.push({
          name: "Content-Type",
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

  // Renaming a path placeholder has to rewrite the URL and rename the parameter together, or the
  // value detaches from the placeholder.
  // NOTE: Reads the request fresh rather than closing over `activeRequest`. The row that calls this
  //  holds onto it until the URL's placeholders change, so a captured request would go stale and
  //  patch its parameter list back over newer edits.
  const handleRenamePathPlaceholder = useCallback(
    (oldName: string, newName: string) => {
      const request = getModel("http_request", activeRequestId);
      if (request == null) return false;

      const patch = renamePathPlaceholder(request, oldName, newName);
      if (patch == null) return false; // Unusable name, so the editor reverts the field
      void patchModel(request, patch);
      return true;
    },
    [activeRequestId],
  );

  const { urlParameterPairs, urlParametersKey } = useMemo(
    () =>
      derivePathPlaceholderPairs(
        activeRequest.url,
        activeRequest.urlParameters,
        handleRenamePathPlaceholder,
      ),
    [activeRequest.url, activeRequest.urlParameters, handleRenamePathPlaceholder],
  );

  let numParams = 0;
  if (
    activeRequest.bodyType === BODY_TYPE_FORM_URLENCODED ||
    activeRequest.bodyType === BODY_TYPE_FORM_MULTIPART
  ) {
    numParams = Array.isArray(activeRequest.body?.form)
      ? activeRequest.body.form.filter((p) => p.name).length
      : 0;
  }

  const hasDescription = activeRequest.description.trim().length > 0;

  const bodyTab = useMemo<TabItem>(
    () =>
      ({
        value: TAB_BODY,
        rightSlot: numParams > 0 ? <CountBadge count={numParams} /> : null,
        options: {
          value: activeRequest.bodyType,
          items: [
            { type: "separator", label: "Form Data" },
            { label: "Url Encoded", value: BODY_TYPE_FORM_URLENCODED },
            { label: "Multi-Part", value: BODY_TYPE_FORM_MULTIPART },
            { type: "separator", label: "Text Content" },
            { label: "GraphQL", value: BODY_TYPE_GRAPHQL },
            { label: "JSON", value: BODY_TYPE_JSON },
            { label: "XML", value: BODY_TYPE_XML },
            {
              label: "Other",
              value: BODY_TYPE_OTHER,
              shortLabel: nameOfContentTypeOr(contentType, "Other"),
            },
            { type: "separator", label: "Other" },
            { label: "Binary File", value: BODY_TYPE_BINARY },
            { label: "No Body", shortLabel: "Body", value: BODY_TYPE_NONE },
          ],
          onChange: async (bodyType) => {
            if (bodyType === activeRequest.bodyType) return;

            const showMethodToast = (newMethod: string) => {
              if (activeRequest.method.toLowerCase() === newMethod.toLowerCase()) return;
              showToast({
                id: "switched-method",
                message: (
                  <>
                    Request method switched to <InlineCode>POST</InlineCode>
                  </>
                ),
              });
            };

            const patch: Partial<HttpRequest> = {
              bodyType,
              body: convertRequestBody({
                body: activeRequest.body,
                fromBodyType: activeRequest.bodyType,
                toBodyType: bodyType,
              }),
            };
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
                activeRequest.method.toLowerCase() === "get";
              const requiresPost = bodyType === BODY_TYPE_FORM_MULTIPART;
              if (isDefaultishRequest || requiresPost) {
                patch.method = "POST";
                showMethodToast(patch.method);
              }
              newContentType = bodyType === BODY_TYPE_OTHER ? "text/plain" : bodyType;
            } else if (bodyType === BODY_TYPE_GRAPHQL) {
              patch.method = "POST";
              newContentType = "application/json";
              showMethodToast(patch.method);
            }

            if (newContentType !== undefined) {
              await handleContentTypeChange(newContentType, patch);
            } else {
              await patchModel(activeRequest, patch);
            }
          },
        },
      }) satisfies TabItem,
    [activeRequest, contentType, handleContentTypeChange, numParams],
  );

  const { mutate: sendRequest } = useSendAnyHttpRequest();
  const { activeResponse } = usePinnedHttpResponse(activeRequestId);
  const { mutate: cancelResponse } = useCancelHttpResponse(activeResponse?.id ?? null);
  const updateKey = useRequestUpdateKey(activeRequestId);

  const handleBodyChange = useCallback(
    (body: HttpRequest["body"]) => patchModelDebounced(activeRequest, { body }),
    [activeRequest],
  );

  const handleBodyTextChange = useCallback(
    (text: string) => patchModelDebounced(activeRequest, { body: { ...activeRequest.body, text } }),
    [activeRequest],
  );

  const autocompleteUrls = useAtomValue(requestUrlOptionsAtom);

  const autocomplete: GenericCompletionConfig = useMemo(
    () => getUrlCompletionConfig(autocompleteUrls),
    [autocompleteUrls],
  );

  const handlePaste = useCallback(
    async (e: ClipboardEvent, text: string) => {
      if (looksLikeCurl(text)) {
        importCurl.mutate({ overwriteRequestId: activeRequestId, command: text });
      } else {
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
      }
    },
    [activeRequest, activeRequestId, forceParamsRefresh, forceUrlRefresh],
  );
  const handleSend = useCallback(
    () => sendRequest(activeRequest.id ?? null),
    [activeRequest.id, sendRequest],
  );

  const handleUrlChange = useCallback(
    (url: string) => patchModelDebounced(activeRequest, { url }),
    [activeRequest],
  );

  const handleJsonOrBodyTextChange = useCallback(
    (text: string, bodyType: string | null) => {
      // JSON writes at once, as its editor always has; other text debounces
      if (bodyType === BODY_TYPE_JSON) {
        return patchModel(activeRequest, { body: { ...activeRequest.body, text } });
      }
      return handleBodyTextChange(text);
    },
    [activeRequest, handleBodyTextChange],
  );

  const handleSendJsonCommentsChange = useCallback(
    (sendJsonComments: boolean) => {
      const newBody = { ...activeRequest.body };
      if (sendJsonComments) {
        newBody.sendJsonComments = true;
      } else {
        delete newBody.sendJsonComments;
      }
      fireAndForget(patchModel(activeRequest, { body: newBody }));
    },
    [activeRequest],
  );

  const requestView = useMemo(() => httpRequestToView(activeRequest), [activeRequest]);

  const extraTabs = useMemo<ExtraPaneTab[]>(
    () => [
      {
        tab: {
          value: TAB_SETTINGS,
          label: "Settings",
          rightSlot: <CountBadge count={numSettingsOverrides} />,
        },
        content: <ModelSettingsEditor model={activeRequest} />,
      },
      {
        tab: {
          value: TAB_DESCRIPTION,
          label: "Info",
          rightSlot: hasDescription && <CountBadge count={true} />,
        },
        content: (
          <div className="grid grid-rows-[auto_minmax(0,1fr)] h-full">
            <PlainInput
              label="Request Name"
              hideLabel
              forceUpdateKey={updateKey}
              defaultValue={activeRequest.name}
              className="font-sans text-xl! px-0!"
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
        ),
      },
    ],
    [activeRequest, hasDescription, numSettingsOverrides, updateKey],
  );

  const renderBody = useCallback(
    (sharedEditor: ReactNode) => (
      <ConfirmLargeRequestBody request={activeRequest}>
        {activeRequest.bodyType === BODY_TYPE_GRAPHQL ? (
          <Suspense>
            <GraphQLEditor
              forceUpdateKey={forceUpdateKey}
              baseRequest={activeRequest}
              request={activeRequest}
              onChange={handleBodyChange}
            />
          </Suspense>
        ) : activeRequest.bodyType === BODY_TYPE_BINARY ? (
          <BinaryFileEditor
            requestId={activeRequest.id}
            contentType={contentType}
            body={activeRequest.body}
            onChange={(body) => patchModelDebounced(activeRequest, { body })}
            onChangeContentType={handleContentTypeChange}
          />
        ) : (
          sharedEditor
        )}
      </ConfirmLargeRequestBody>
    ),
    [activeRequest, contentType, forceUpdateKey, handleBodyChange, handleContentTypeChange],
  );

  const renderUrlParameters = useCallback(
    (pairs: EditablePair[]) => (
      <UrlParametersEditor
        stateKey={`params.${activeRequest.id}`}
        forceUpdateKey={forceUpdateKey + urlParametersKey}
        pairs={pairs}
        onChange={(urlParameters) => patchModelDebounced(activeRequest, { urlParameters })}
      />
    ),
    [activeRequest, forceUpdateKey, urlParametersKey],
  );

  return (
    <HttpRequestPaneView
      editable
      style={style}
      className={className}
      fullHeight={fullHeight}
      request={requestView}
      tabsRef={tabsRef}
      tabsStorageKey={TABS_STORAGE_KEY}
      forceUpdateKey={forceUpdateKey}
      urlBarKey={forceUpdateKey + urlKey}
      urlForceUpdateKey={updateKey}
      urlAutocomplete={autocomplete}
      onUrlChange={handleUrlChange}
      onUrlPasteOverwrite={handlePaste}
      onSend={handleSend}
      onCancel={cancelResponse}
      isSending={activeResponse != null && activeResponse.state !== "closed"}
      sendHotkeyAction="request.send"
      focusHotkeyAction="url_bar.focus"
      methodSlot={<RequestMethodDropdown request={activeRequest} className="ml-0.5 h-full!" />}
      bodyTab={bodyTab}
      renderBody={renderBody}
      onBodyChange={handleBodyChange}
      onBodyTextChange={handleJsonOrBodyTextChange}
      onSendJsonCommentsChange={handleSendJsonCommentsChange}
      jsonNoticeStorageKey={activeRequest.workspaceId}
      urlParameterPairs={urlParameterPairs}
      renderUrlParameters={renderUrlParameters}
      headersTabs={headersTab}
      inheritedHeaders={inheritedHeaders}
      headersForceUpdateKey={`${forceUpdateHeaderEditorKey}::${forceUpdateKey}`}
      onHeadersChange={(headers) => patchModelDebounced(activeRequest, { headers })}
      authTabs={authTab}
      authContent={<HttpAuthenticationEditor model={activeRequest} />}
      extraTabs={extraTabs}
    />
  );
}

function nameOfContentTypeOr(contentType: string | null, fallback: string) {
  const language = languageFromContentType(contentType);
  if (language === "markdown") {
    return "Markdown";
  }
  return fallback;
}
