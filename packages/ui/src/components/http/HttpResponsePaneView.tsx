import classNames from "classnames";
import type { CSSProperties, ReactElement, ReactNode } from "react";
import { Suspense, useMemo } from "react";
import { getMimeTypeFromContentType } from "../../lib/mimeType";
import { Banner } from "../Banner";
import { CountBadge } from "../CountBadge";
import type { DropdownItem } from "../Dropdown";
import { type EditorHost, useEditorHost } from "../EditorHost";
import { Icon } from "../Icon";
import { LoadingIcon } from "../LoadingIcon";
import { HStack } from "../Stacks";
import type { TabItem } from "../tabs/Tabs";
import { TabContent, Tabs } from "../tabs/Tabs";
import { HttpResponseDurationTagRaw } from "../tags/HttpResponseDurationTag";
import { HttpStatusTagRaw } from "../tags/HttpStatusTag";
import { SizeTag } from "../tags/SizeTag";
import { ConfirmLargeResponse } from "./ConfirmLargeResponse";
import { RequestBodyViewer } from "./RequestBodyViewer";
import type { ResponseTextViewerExtras, ResponseViewMode } from "./ResponseBodyViewer";
import { ResponseBodyViewer } from "./ResponseBodyViewer";
import { parseCookieHeaders, ResponseCookies } from "./ResponseCookies";
import { ResponseHeaders } from "./ResponseHeaders";
import type { HttpBodyLoader, HttpResponseView } from "./types";

export const RESPONSE_TAB_BODY = "body";
export const RESPONSE_TAB_REQUEST = "request";
export const RESPONSE_TAB_HEADERS = "headers";
export const RESPONSE_TAB_COOKIES = "cookies";

/** A tab only one app has, like the client's timeline, with what it shows */
export interface ExtraPaneTab {
  tab: TabItem;
  content: ReactNode;
}

export interface HttpResponsePaneViewProps {
  response: HttpResponseView | null;
  /** Reads the response body */
  body: HttpBodyLoader | null;
  /** Reads the request body the response answered */
  requestBody: HttpBodyLoader | null;
  style?: CSSProperties;
  className?: string;
  /** Shown before there's a response */
  emptyState: ReactNode;
  viewMode?: ResponseViewMode;
  /**
   * Offers the raw view in the Response tab's menu. Left out where the body tab has a view-mode
   * switch of its own, as the proxy's does
   */
  onViewModeChange?: (viewMode: ResponseViewMode) => void;
  /** Where the tab order and the active tab are remembered */
  tabsStorageKey?: string;
  /** Remembers the active tab per request or flow */
  activeTabKey: string;
  /** Between the status and the right of the status line, like a warning */
  statusLineCenter?: ReactNode;
  /** At the right of the status line, like a menu of earlier responses */
  statusLineRight?: ReactNode;
  onSaveBody?: () => void;
  onCopyBody?: () => void;
  onCopyAsCurl?: () => void;
  /** Stop a request that's still being sent */
  onCancel?: () => void;
  /** Overrides the cookie counts the tab shows, when the app counts them its own way */
  cookieCounts?: { sent: number; received: number };
  /** Tabs only the app has, after the shared ones */
  extraTabs?: ExtraPaneTab[];
  textViewer?: ResponseTextViewerExtras;
  /** Viewers only this app has for a response body, like the client's event stream viewer */
  renderBodyViewer?: EditorHost["renderBodyViewer"];
  /** More rows for the Headers tab's Info section */
  infoRows?: ReactElement[];
  /** The copy button for a body held back for its size */
  renderCopyButton?: (getText: () => Promise<string | null>) => ReactNode;
  /**
   * The request is shown apart, as the proxy's card shows it beside the response: no Request
   * tab, and Headers and Cookies hold the response's alone
   */
  requestShownApart?: boolean;
  /** Drawn inside a card the app draws, without a card of its own */
  bare?: boolean;
  /**
   * The tab to open on for a key with no tab of its own; with it, a tab chosen under one key
   * doesn't carry to the next
   */
  defaultTab?: string;
  /** The tab to show over any remembered, while this response offers it */
  activeTab?: string;
  /** A tab was chosen */
  onTabChange?: (tab: string) => void;
}

/** Yaak's response pane: a status line over Response, Request, Headers and Cookies tabs */
export function HttpResponsePaneView({
  response,
  body,
  requestBody,
  style,
  className,
  emptyState,
  viewMode = "pretty",
  onViewModeChange,
  tabsStorageKey = "http_response_tabs",
  activeTabKey,
  statusLineCenter,
  statusLineRight,
  onSaveBody,
  onCopyBody,
  onCopyAsCurl,
  onCancel,
  cookieCounts: cookieCountsOverride,
  extraTabs,
  textViewer,
  renderBodyViewer,
  infoRows,
  renderCopyButton,
  requestShownApart = false,
  bare = false,
  defaultTab,
  activeTab,
  onTabChange,
}: HttpResponsePaneViewProps) {
  const { ErrorBoundary } = useEditorHost();
  const mimeType =
    response?.contentType == null ? null : getMimeTypeFromContentType(response.contentType).essence;

  const cookieCounts = useMemo(() => {
    if (cookieCountsOverride != null) return cookieCountsOverride;
    if (response == null) return { sent: 0, received: 0 };
    const { sentCookies, receivedCookies } = parseCookieHeaders(response.cookieHeaders);
    return { sent: sentCookies.length, received: receivedCookies.length };
  }, [cookieCountsOverride, response]);

  const tabs = useMemo<TabItem[]>(() => {
    const bodyActionsDisabled = response?.state !== "closed" && (response?.status ?? 0) >= 100;
    const bodyActionsHidden = response == null || !!response.error;
    const itemsAfter: DropdownItem[] = [
      ...(onSaveBody != null
        ? [
            {
              label: "Save to File",
              onSelect: onSaveBody,
              leftSlot: <Icon icon="save" />,
              hidden: bodyActionsHidden,
              disabled: bodyActionsDisabled,
            },
          ]
        : []),
      ...(onCopyBody != null
        ? [
            {
              label: "Copy Body",
              onSelect: onCopyBody,
              leftSlot: <Icon icon="copy" />,
              hidden: bodyActionsHidden,
              disabled: bodyActionsDisabled,
            },
          ]
        : []),
      ...(onCopyAsCurl != null
        ? [{ label: "Copy as cURL", onSelect: onCopyAsCurl, leftSlot: <Icon icon="copy" /> }]
        : []),
    ];

    const headerCount = response?.headers.length ?? 0;
    return [
      onViewModeChange == null && itemsAfter.length === 0
        ? { value: RESPONSE_TAB_BODY, label: "Response" }
        : {
            value: RESPONSE_TAB_BODY,
            options: {
              value: viewMode,
              onChange: (v: string | null) => onViewModeChange?.(v === "raw" ? "raw" : "pretty"),
              items: [
                { label: "Response", value: "pretty" },
                ...(onViewModeChange == null || mimeType?.startsWith("image")
                  ? []
                  : [{ label: "Response (Raw)", shortLabel: "Raw", value: "raw" }]),
              ],
              itemsAfter: itemsAfter.length > 0 ? itemsAfter : undefined,
            },
          },
      ...(requestShownApart
        ? []
        : [
            {
              value: RESPONSE_TAB_REQUEST,
              label: "Request",
              rightSlot:
                (response?.requestContentLength ?? 0) > 0 ? <CountBadge count={true} /> : null,
            },
          ]),
      {
        value: RESPONSE_TAB_HEADERS,
        label: "Headers",
        rightSlot: requestShownApart ? (
          <CountBadge count={headerCount} />
        ) : (
          <CountBadge count={response?.requestHeaders.length ?? 0} count2={headerCount} showZero />
        ),
      },
      {
        value: RESPONSE_TAB_COOKIES,
        label: "Cookies",
        rightSlot: requestShownApart ? (
          <CountBadge count={cookieCounts.received} />
        ) : cookieCounts.sent > 0 || cookieCounts.received > 0 ? (
          <CountBadge count={cookieCounts.sent} count2={cookieCounts.received} showZero />
        ) : null,
      },
      ...(extraTabs?.map((t) => t.tab) ?? []),
    ];
  }, [
    cookieCounts,
    extraTabs,
    mimeType,
    onCopyAsCurl,
    onCopyBody,
    onSaveBody,
    onViewModeChange,
    requestShownApart,
    response,
    viewMode,
  ]);

  return (
    <div
      style={style}
      className={classNames(
        className,
        "x-theme-responsePane",
        "max-h-full h-full overflow-hidden relative",
        !bare && "bg-surface rounded-md border border-border-subtle",
      )}
    >
      {response == null ? (
        emptyState
      ) : (
        <div className="h-full w-full grid grid-rows-[auto_minmax(0,1fr)] grid-cols-1">
          <HStack
            className={classNames(
              "text-text-subtle w-full shrink-0",
              // Remove a bit of space because the tabs have lots too
              "-mb-1.5",
            )}
          >
            <ResponseStatusLine
              response={response}
              center={statusLineCenter}
              right={statusLineRight}
            />
          </HStack>

          <div className="overflow-hidden flex flex-col min-h-0">
            {response.error && (
              <Banner color="danger" className="mx-3 mt-1 shrink-0">
                {response.error}
              </Banner>
            )}
            {/* Show tabs if we have any data (headers, body, etc.) even if there's an error */}
            <Tabs
              tabs={tabs}
              label="Response"
              className="ml-3 mr-3 mb-3 min-h-0 flex-1"
              tabListClassName="mt-0.5 -mb-1.5"
              storageKey={tabsStorageKey}
              activeTabKey={activeTabKey}
              defaultValue={defaultTab}
              value={activeTab}
              keyedDefault={defaultTab != null}
              onChangeValue={onTabChange}
            >
              <TabContent value={RESPONSE_TAB_BODY} ErrorBoundary={ErrorBoundary}>
                <ErrorBoundary name="Http Response Viewer">
                  <Suspense>
                    <ConfirmLargeResponse
                      contentLength={response.contentLength}
                      contentType={response.contentType}
                      onSave={onSaveBody}
                      getText={body?.getText}
                      renderCopyButton={renderCopyButton}
                    >
                      {body != null && (
                        <ResponseBodyViewer
                          response={response}
                          body={body}
                          viewMode={viewMode}
                          textViewer={textViewer}
                          onCancel={onCancel}
                          renderBodyViewer={renderBodyViewer}
                        />
                      )}
                    </ConfirmLargeResponse>
                  </Suspense>
                </ErrorBoundary>
              </TabContent>
              {!requestShownApart && (
              <TabContent value={RESPONSE_TAB_REQUEST} ErrorBoundary={ErrorBoundary}>
                <ConfirmLargeResponse
                  contentLength={response.requestContentLength}
                  contentType={response.contentType}
                  noun="content"
                  revealLabel="Reveal Request Body"
                  getText={requestBody?.getText}
                  renderCopyButton={renderCopyButton}
                >
                  {requestBody != null && (
                    <RequestBodyViewer
                      id={response.id}
                      contentType={findHeader(response.requestHeaders, "content-type")}
                      body={requestBody}
                    />
                  )}
                </ConfirmLargeResponse>
              </TabContent>
              )}
              <TabContent value={RESPONSE_TAB_HEADERS} ErrorBoundary={ErrorBoundary}>
                <ResponseHeaders
                  response={response}
                  infoRows={infoRows}
                  responseOnly={requestShownApart}
                />
              </TabContent>
              <TabContent value={RESPONSE_TAB_COOKIES} ErrorBoundary={ErrorBoundary}>
                <ResponseCookies
                  response={response}
                  side={requestShownApart ? "received" : undefined}
                />
              </TabContent>
              {extraTabs?.map(({ tab, content }) => (
                <TabContent key={tab.value} value={tab.value} ErrorBoundary={ErrorBoundary}>
                  {content}
                </TabContent>
              ))}
            </Tabs>
          </div>
        </div>
      )}
    </div>
  );
}

/** The status, time and size of a response, with room for the app's own pieces */
export function ResponseStatusLine({
  response,
  center,
  right,
}: {
  response: HttpResponseView;
  center?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div
      className={classNames(
        "grid grid-cols-[auto_minmax(4rem,1fr)_auto]",
        // As tall as an `h-sm` button with `m-0.5` (the client's response history menu), so the
        // status sits the same distance from the card's edge with or without one on the right
        "min-h-[calc(var(--height-sm)+0.25rem)]",
        "cursor-default select-none",
        "whitespace-nowrap w-full pl-3 overflow-x-auto font-mono text-sm hide-scrollbars",
      )}
    >
      <HStack space={2} className="w-full shrink-0">
        {response.state !== "closed" && <LoadingIcon size="sm" />}
        <HttpStatusTagRaw
          showReason
          status={response.status}
          state={response.state}
          statusReason={response.statusReason}
        />
        <span>&bull;</span>
        <HttpResponseDurationTagRaw
          closed={response.state === "closed"}
          startedAt={response.startedAt}
          elapsedMs={response.elapsedMs}
          elapsedHeadersMs={response.elapsedHeadersMs}
          elapsedDnsMs={response.elapsedDnsMs}
        />
        <span>&bull;</span>
        <SizeTag
          contentLength={response.contentLength ?? 0}
          contentLengthCompressed={response.contentLengthCompressed}
        />
      </HStack>
      {center ?? <span />}
      <div className="justify-self-end shrink-0">{right}</div>
    </div>
  );
}

function findHeader(headers: { name: string; value: string }[], name: string): string | null {
  return headers.find((h) => h.name.toLowerCase() === name)?.value ?? null;
}
