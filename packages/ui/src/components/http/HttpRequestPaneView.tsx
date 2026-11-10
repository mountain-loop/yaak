import classNames from "classnames";
import type { CSSProperties, ReactNode, Ref } from "react";
import { useMemo } from "react";
import { languageFromContentType } from "../../lib/contentType";
import { CountBadge } from "../CountBadge";
import { EmptyStateText } from "../EmptyStateText";
import type { HostInputProps } from "../EditorHost";
import { useEditorHost } from "../EditorHost";
import { KeyValueRows } from "../KeyValueRow";
import type { HotkeyAction } from "../../hooks/useHotKey";
import type { EditablePair, PairEditorHandle, PairEditorProps } from "../pairs/PairEditor";
import type { TabItem, TabsRef } from "../tabs/Tabs";
import { TabContent, Tabs } from "../tabs/Tabs";
import { FormMultipartEditor } from "./FormMultipartEditor";
import { FormUrlencodedEditor } from "./FormUrlencodedEditor";
import { HeadersEditor } from "./HeadersEditor";
import type { ExtraPaneTab } from "./HttpResponsePaneView";
import { JsonBodyEditor } from "./JsonBodyEditor";
import { RequestBodyViewer } from "./RequestBodyViewer";
import { RequestMethodDropdown } from "./RequestMethodDropdown";
import { KeyValueRow } from "./ResponseHeaders";
import {
  BODY_TYPE_BINARY,
  BODY_TYPE_FORM_MULTIPART,
  BODY_TYPE_FORM_URLENCODED,
  BODY_TYPE_GRAPHQL,
  BODY_TYPE_JSON,
  BODY_TYPE_OTHER,
  BODY_TYPE_XML,
  type HttpBodyLoader,
  type HttpRequestBodyView,
  type HttpRequestView,
} from "./types";
import { UrlBar } from "./UrlBar";
import { UrlParametersEditor } from "./UrlParametersEditor";

export const REQUEST_TAB_BODY = "body";
export const REQUEST_TAB_PARAMS = "params";
export const REQUEST_TAB_HEADERS = "headers";
export const REQUEST_TAB_AUTH = "auth";

export interface HttpRequestPaneViewProps {
  request: HttpRequestView;
  /** Lets the request be changed and sent; without it the pane only shows it */
  editable?: boolean;
  style?: CSSProperties;
  className?: string;
  fullHeight: boolean;
  /** Where the tab order and the active tab are remembered */
  tabsStorageKey?: string;
  tabsRef?: Ref<TabsRef>;
  /** Re-seeds the editors when the request changes from elsewhere */
  forceUpdateKey: string;

  /** The URL bar's own reset key, when the app resets it apart from the rest */
  urlBarKey?: string;
  /** Re-seeds the URL bar's text without remounting it */
  urlForceUpdateKey?: string;
  urlAutocomplete?: HostInputProps["autocomplete"];
  urlPlaceholder?: string;
  onUrlChange?: (url: string) => void;
  onUrlPasteOverwrite?: HostInputProps["onPasteOverwrite"];
  onSend?: () => void;
  onCancel?: () => void;
  isSending?: boolean;
  /** The action whose keys send the request */
  sendHotkeyAction?: HotkeyAction;
  /** The action whose keys select the URL */
  focusHotkeyAction?: HotkeyAction;
  /** Colour the method by what it does */
  methodColored?: boolean;
  onMethodChange?: (method: string) => void | Promise<void>;
  /** Replaces the method shown at the start of the URL bar */
  methodSlot?: ReactNode;

  /** The body tab, when the app offers a menu of body types; otherwise a label names it */
  bodyTab?: TabItem;
  /** Renders the body tab's content, given the shared editor for the body type */
  renderBody?: (sharedEditor: ReactNode) => ReactNode;
  /** Reads a body that isn't text, like a captured binary or multipart one */
  bodyLoader?: HttpBodyLoader;
  onBodyChange?: (body: HttpRequestBodyView) => void;
  /** A text body changed; JSON writes at once, the rest may debounce */
  onBodyTextChange?: (text: string, bodyType: string | null) => void;
  onSendJsonCommentsChange?: (sendJsonComments: boolean) => void;
  /** Where dismissing the JSON comments notice is remembered */
  jsonNoticeStorageKey?: string;

  /** Parameters to edit, when the app derives more than the request's own (path placeholders) */
  urlParameterPairs?: EditablePair[];
  urlParametersForceUpdateKey?: string;
  onUrlParametersChange?: PairEditorProps["onChange"];
  onUrlParametersRef?: (handle: PairEditorHandle) => void;
  /** Overrides the parameters editor, like the client's one wired to its focus events */
  renderUrlParameters?: (pairs: EditablePair[]) => ReactNode;

  /** The headers tab, when the app counts inherited headers into it */
  headersTabs?: TabItem[];
  inheritedHeaders?: HeadersEditorInherited;
  headersForceUpdateKey?: string;
  onHeadersChange?: PairEditorProps["onChange"];

  /** The auth tab and what it shows, when the app edits authentication itself */
  authTabs?: TabItem[];
  authContent?: ReactNode;

  /** Tabs only the app has, after the shared ones */
  extraTabs?: ExtraPaneTab[];

  /** Replaces the URL bar, as the proxy's card shows a captured request's method and URL */
  urlLine?: ReactNode;
  /**
   * The tab to open on for a request with no tab of its own; with it, a tab chosen for one
   * request doesn't carry to the next
   */
  defaultTab?: string;
  /** The tab to show over any remembered, while this request offers it */
  activeTab?: string;
  /** A tab was chosen */
  onTabChange?: (tab: string) => void;
}

type HeadersEditorInherited = { name: string; value: string; enabled?: boolean; id?: string }[];

/** Yaak's request pane: the URL bar over Body, Params, Headers and Auth tabs */
export function HttpRequestPaneView({
  request,
  editable = false,
  style,
  className,
  fullHeight,
  tabsStorageKey = "http_request_tabs",
  tabsRef,
  forceUpdateKey,
  urlBarKey,
  urlForceUpdateKey,
  urlAutocomplete,
  urlPlaceholder = "https://example.com",
  onUrlChange,
  onUrlPasteOverwrite,
  onSend,
  onCancel,
  isSending,
  sendHotkeyAction,
  focusHotkeyAction,
  methodColored,
  onMethodChange,
  methodSlot,
  bodyTab,
  renderBody,
  bodyLoader,
  onBodyChange,
  onBodyTextChange,
  onSendJsonCommentsChange,
  jsonNoticeStorageKey,
  urlParameterPairs,
  urlParametersForceUpdateKey,
  onUrlParametersChange,
  onUrlParametersRef,
  renderUrlParameters,
  headersTabs,
  inheritedHeaders,
  headersForceUpdateKey,
  onHeadersChange,
  authTabs,
  authContent,
  extraTabs,
  urlLine,
  defaultTab,
  activeTab,
  onTabChange,
}: HttpRequestPaneViewProps) {
  const { ErrorBoundary } = useEditorHost();
  const readOnly = !editable;
  const paramPairs = urlParameterPairs ?? request.urlParameters;

  let numParams = 0;
  if (
    request.bodyType === BODY_TYPE_FORM_URLENCODED ||
    request.bodyType === BODY_TYPE_FORM_MULTIPART
  ) {
    numParams = Array.isArray(request.body?.form)
      ? request.body.form.filter((p) => p.name).length
      : 0;
  }

  const headerCount = request.headers.filter((h) => h.name && h.enabled !== false).length;
  const tabs = useMemo<TabItem[]>(
    () => [
      bodyTab ?? {
        value: REQUEST_TAB_BODY,
        label: bodyTypeLabel(request.bodyType, request.contentType),
        rightSlot: numParams > 0 ? <CountBadge count={numParams} /> : null,
      },
      {
        value: REQUEST_TAB_PARAMS,
        rightSlot: <CountBadge count={paramPairs.length} />,
        label: "Params",
      },
      ...(headersTabs ?? [
        {
          value: REQUEST_TAB_HEADERS,
          label: "Headers",
          rightSlot: <CountBadge count={headerCount} />,
        },
      ]),
      ...(authTabs ??
        (request.auth == null
          ? []
          : [
              {
                value: REQUEST_TAB_AUTH,
                label: request.auth.label,
              },
            ])),
      ...(extraTabs?.map((t) => t.tab) ?? []),
    ],
    [
      authTabs,
      bodyTab,
      extraTabs,
      headerCount,
      headersTabs,
      numParams,
      paramPairs.length,
      request.auth,
      request.bodyType,
      request.contentType,
    ],
  );

  const sharedBody = (
    <RequestBodyEditor
      request={request}
      readOnly={readOnly}
      fullHeight={fullHeight}
      forceUpdateKey={forceUpdateKey}
      bodyLoader={bodyLoader}
      onBodyChange={onBodyChange}
      onBodyTextChange={onBodyTextChange}
      onSendJsonCommentsChange={onSendJsonCommentsChange}
      jsonNoticeStorageKey={jsonNoticeStorageKey ?? request.id}
    />
  );

  return (
    <div
      style={style}
      className={classNames(className, "h-full grid grid-rows-[auto_minmax(0,1fr)] grid-cols-1")}
    >
      {urlLine ?? (
      <UrlBar
        stateKey={`url.${request.id}`}
        key={urlBarKey}
        url={request.url}
        placeholder={urlPlaceholder}
        onPasteOverwrite={onUrlPasteOverwrite}
        autocomplete={urlAutocomplete}
        onSend={onSend}
        onCancel={onCancel}
        onUrlChange={onUrlChange}
        readOnly={readOnly}
        sendHotkeyAction={readOnly ? undefined : sendHotkeyAction}
        focusHotkeyAction={readOnly ? undefined : focusHotkeyAction}
        leftSlot={
          <div className="py-0.5">
            {methodSlot ?? (
              <RequestMethodDropdown
                method={request.method}
                colored={methodColored}
                onChange={onMethodChange}
                readOnly={readOnly}
                className="ml-0.5 h-full!"
              />
            )}
          </div>
        }
        forceUpdateKey={urlForceUpdateKey ?? forceUpdateKey}
        isLoading={isSending}
      />
      )}
      <Tabs
        ref={tabsRef}
        label="Request"
        tabs={tabs}
        tabListClassName="mt-1 -mb-1.5"
        storageKey={tabsStorageKey}
        activeTabKey={request.id}
        defaultValue={defaultTab}
        value={activeTab}
        keyedDefault={defaultTab != null}
        onChangeValue={onTabChange}
      >
        <TabContent value={REQUEST_TAB_AUTH} ErrorBoundary={ErrorBoundary}>
          {authContent ?? (request.auth != null && <AuthDisplay auth={request.auth} />)}
        </TabContent>
        <TabContent value={REQUEST_TAB_HEADERS} ErrorBoundary={ErrorBoundary}>
          <HeadersEditor
            inheritedHeaders={inheritedHeaders}
            forceUpdateKey={headersForceUpdateKey ?? forceUpdateKey}
            headers={request.headers}
            stateKey={`headers.${request.id}`}
            onChange={onHeadersChange}
            readOnly={readOnly}
          />
        </TabContent>
        <TabContent value={REQUEST_TAB_PARAMS} ErrorBoundary={ErrorBoundary}>
          {renderUrlParameters?.(paramPairs) ?? (
            <UrlParametersEditor
              stateKey={`params.${request.id}`}
              forceUpdateKey={urlParametersForceUpdateKey ?? forceUpdateKey}
              pairs={paramPairs}
              onChange={onUrlParametersChange}
              setRef={onUrlParametersRef}
              readOnly={readOnly}
            />
          )}
        </TabContent>
        <TabContent value={REQUEST_TAB_BODY} ErrorBoundary={ErrorBoundary}>
          {renderBody ? renderBody(sharedBody) : sharedBody}
        </TabContent>
        {extraTabs?.map(({ tab, content }) => (
          <TabContent key={tab.value} value={tab.value} ErrorBoundary={ErrorBoundary}>
            {content}
          </TabContent>
        ))}
      </Tabs>
    </div>
  );
}

interface RequestBodyEditorProps {
  request: HttpRequestView;
  readOnly: boolean;
  fullHeight: boolean;
  forceUpdateKey: string;
  bodyLoader?: HttpBodyLoader;
  onBodyChange?: (body: HttpRequestBodyView) => void;
  onBodyTextChange?: (text: string, bodyType: string | null) => void;
  onSendJsonCommentsChange?: (sendJsonComments: boolean) => void;
  jsonNoticeStorageKey: string;
}

/** The editor for a request body's type: JSON, XML, forms, or any other text */
export function RequestBodyEditor({
  request,
  readOnly,
  fullHeight,
  forceUpdateKey,
  bodyLoader,
  onBodyChange,
  onBodyTextChange,
  onSendJsonCommentsChange,
  jsonNoticeStorageKey,
}: RequestBodyEditorProps) {
  const { Editor } = useEditorHost();
  const { bodyType } = request;
  const handleTextChange = (text: string) => onBodyTextChange?.(text, bodyType);

  // A captured body that isn't text shows in the viewer for its content type
  if (
    bodyLoader != null &&
    (bodyType === BODY_TYPE_BINARY || bodyType === BODY_TYPE_FORM_MULTIPART) &&
    readOnly
  ) {
    return (
      <RequestBodyViewer id={request.id} contentType={request.contentType} body={bodyLoader} />
    );
  }

  if (bodyType === BODY_TYPE_JSON) {
    return (
      <JsonBodyEditor
        forceUpdateKey={forceUpdateKey}
        heightMode={fullHeight ? "full" : "auto"}
        requestId={request.id}
        text={request.body?.text ?? ""}
        sendJsonComments={request.body?.sendJsonComments === true}
        onChange={handleTextChange}
        onChangeSendJsonComments={onSendJsonCommentsChange}
        noticeStorageKey={jsonNoticeStorageKey}
        readOnly={readOnly}
      />
    );
  }
  if (bodyType === BODY_TYPE_XML) {
    return (
      <Editor
        forceUpdateKey={forceUpdateKey}
        autocompleteFunctions
        autocompleteVariables
        placeholder="..."
        heightMode={fullHeight ? "full" : "auto"}
        defaultValue={`${request.body?.text ?? ""}`}
        language="xml"
        onChange={handleTextChange}
        readOnly={readOnly}
        stateKey={`xml.${request.id}`}
      />
    );
  }
  if (bodyType === BODY_TYPE_FORM_URLENCODED) {
    return (
      <FormUrlencodedEditor
        forceUpdateKey={forceUpdateKey}
        requestId={request.id}
        form={request.body.form}
        onChange={onBodyChange}
        readOnly={readOnly}
      />
    );
  }
  if (bodyType === BODY_TYPE_FORM_MULTIPART) {
    return (
      <FormMultipartEditor
        forceUpdateKey={forceUpdateKey}
        requestId={request.id}
        form={request.body.form}
        onChange={onBodyChange}
        readOnly={readOnly}
      />
    );
  }
  if (typeof bodyType === "string" && bodyType !== BODY_TYPE_BINARY) {
    return (
      <Editor
        forceUpdateKey={forceUpdateKey}
        autocompleteFunctions
        autocompleteVariables
        language={languageFromContentType(request.contentType)}
        placeholder="..."
        heightMode={fullHeight ? "full" : "auto"}
        defaultValue={`${request.body?.text ?? ""}`}
        onChange={handleTextChange}
        readOnly={readOnly}
        stateKey={`other.${request.id}`}
      />
    );
  }
  return <EmptyStateText>No Body</EmptyStateText>;
}

function AuthDisplay({ auth }: { auth: NonNullable<HttpRequestView["auth"]> }) {
  return (
    <KeyValueRows>
      {auth.values.map((v) => (
        <KeyValueRow key={v.name} labelColor="primary" label={v.name}>
          {v.value}
        </KeyValueRow>
      ))}
    </KeyValueRows>
  );
}

/** What the body tab is called when there's no menu of body types to name it */
export function bodyTypeLabel(bodyType: string | null, contentType: string | null): string {
  switch (bodyType) {
    case BODY_TYPE_JSON:
      return "JSON";
    case BODY_TYPE_XML:
      return "XML";
    case BODY_TYPE_GRAPHQL:
      return "GraphQL";
    case BODY_TYPE_FORM_URLENCODED:
      return "Url Encoded";
    case BODY_TYPE_FORM_MULTIPART:
      return "Multi-Part";
    case BODY_TYPE_BINARY:
      return "Binary";
    case BODY_TYPE_OTHER:
      return languageFromContentType(contentType) === "markdown" ? "Markdown" : "Other";
    case null:
      return "Body";
    default:
      return "Body";
  }
}
