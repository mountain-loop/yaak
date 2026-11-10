import { formatSize } from "@yaakapp-internal/lib/formatSize";
import type { Flow, FlowBody } from "@yaakapp-internal/proxy-lib";
import {
  CONTROL_TOOLTIP_DELAY,
  CountBadge,
  Dropdown,
  EmptyStateText,
  type ExtraPaneTab,
  FormUrlencodedEditor,
  type HttpBodyResult,
  HttpRequestPaneView,
  HttpResponsePaneView,
  Icon,
  IconButton,
  parseCookieHeaders,
  ResponseCookies,
  SplitLayout,
  Tooltip,
} from "@yaakapp-internal/ui";
import classNames from "classnames";
import { useAtomValue, useSetAtom, useStore } from "jotai";
import { useCallback, useMemo } from "react";
import { BODY_TYPE_FORM_URLENCODED } from "@yaakapp-internal/ui/httpTypes";
import { placeTabsAtom } from "../lib/atoms";
import { findHeader } from "../lib/body";
import {
  browserTabMemory,
  defaultTabFor,
  type FlowPane,
  learnTab,
  REQUEST_TAB_AUTH,
  REQUEST_TAB_BODY,
  REQUEST_TAB_COOKIES,
  REQUEST_TAB_HEADERS,
  REQUEST_TAB_PARAMS,
  RESPONSE_TAB_BODY,
  RESPONSE_TAB_COOKIES,
  RESPONSE_TAB_HEADERS,
  RESPONSE_TAB_INFO,
  RESPONSE_TAB_MESSAGES,
  RESPONSE_TAB_TIMELINE,
} from "../lib/defaultTab";
import { saveDialogFlowAtom, useFlowActions } from "../lib/flowActions";
import {
  type FlowBodyData,
  flowBodyLoader,
  flowCookiesView,
  flowRequestToView,
  flowResponseToView,
} from "../lib/flowViews";
import { messagesTabLabel } from "../lib/messages";
import { goToPlace } from "../lib/navigation";
import { FlowBodyViewer, useFlowBody } from "./FlowBodyViewer";
import { FlowInfo } from "./FlowInfo";
import { FlowRequestBody } from "./FlowRequestBody";
import { FlowMessages } from "./FlowMessages";
import { FlowTimeline } from "./FlowTimeline";
import { ProxyEditorHost } from "./ProxyEditorHost";

/**
 * One card for a flow: the request half (its URL line and tabs), a hairline, and the response
 * half (its status line and tabs). The halves sit perpendicular to the list: stacked when the
 * list is beside the card, side by side when it is above.
 */
export function FlowCard({ flow, listBeside }: { flow: Flow; listBeside: boolean }) {
  return (
    <ProxyEditorHost>
      <SplitLayout
        storageKey={listBeside ? "proxy_card_stacked" : "proxy_card_side"}
        layout={listBeside ? "vertical" : "horizontal"}
        minHeightPx={120}
        minWidthPx={240}
        firstSlot={({ style }) => (
          <div style={style}>
            <FlowRequestHalf flow={flow} />
          </div>
        )}
        secondSlot={({ style, orientation }) => (
          <div style={style}>
            <FlowResponseHalf
              flow={flow}
              className={orientation === "vertical" ? "border-t" : "border-l"}
            />
          </div>
        )}
      />
    </ProxyEditorHost>
  );
}

/**
 * The tab a half opens on, and learning from the ones chosen by hand. The tab chosen is part of
 * the window's place, so going back to it, or reloading, opens it again.
 */
function useShapeTab(pane: FlowPane, flow: Flow, available: string[]) {
  const store = useStore();
  const memory = browserTabMemory();
  const activeTab = useAtomValue(placeTabsAtom)[pane];
  // Read again for every flow, so a tab learned on one opens the next of its shape
  const defaultTab = defaultTabFor(pane, flow, available, memory);
  const onTabChange = useCallback(
    (tab: string) => {
      learnTab(pane, flow, tab, memory);
      goToPlace(store, "update", { tabs: { ...store.get(placeTabsAtom), [pane]: tab } });
    },
    [pane, flow, memory, store],
  );
  return { activeTab, defaultTab, onTabChange };
}

/** A body read through the engine's body RPC, as the shared panes' loaders ask for it */
function useLoadedBody(
  flow: Flow,
  which: FlowBody,
  enabled = true,
): HttpBodyResult<FlowBodyData | null> {
  const size = which === "request" ? flow.requestSize : flow.responseSize;
  const load = enabled && size > 0;
  const body = useFlowBody(flow, which, load);
  if (!load) return { data: null, isLoading: false, error: null };
  return { data: body.data ?? undefined, isLoading: body.isLoading, error: body.error };
}

function FlowRequestHalf({ flow }: { flow: Flow }) {
  const body = useLoadedBody(flow, "request");
  const request = useMemo(() => flowRequestToView(flow, body.data ?? null), [flow, body.data]);
  const loader = useMemo(
    () =>
      flowBodyLoader({
        useBody: () => useLoadedBody(flow, "request"),
        contentType: findHeader(flow.requestHeaders, "content-type"),
      }),
    [flow],
  );
  const cookies = useMemo(() => flowCookiesView(flow), [flow]);
  const sentCount = useMemo(
    () => parseCookieHeaders(cookies.cookieHeaders).sentCookies.length,
    [cookies],
  );
  const extraTabs = useMemo<ExtraPaneTab[]>(
    () => [
      {
        tab: {
          value: REQUEST_TAB_COOKIES,
          label: "Cookies",
          rightSlot: <CountBadge count={sentCount} />,
        },
        content: <ResponseCookies response={cookies} side="sent" />,
      },
    ],
    [cookies, sentCount],
  );
  const available = [
    REQUEST_TAB_BODY,
    REQUEST_TAB_PARAMS,
    REQUEST_TAB_HEADERS,
    ...(request.auth == null ? [] : [REQUEST_TAB_AUTH]),
    REQUEST_TAB_COOKIES,
  ];
  const { activeTab, defaultTab, onTabChange } = useShapeTab("request", flow, available);

  const forceUpdateKey = `${flow.updatedAt}.${body.data == null ? "" : "loaded"}`;

  return (
    <HttpRequestPaneView
      // Padded below as the response half's tabs are, so their content, and the actions bar
      // over it, sit the same distance from the card's edges
      className="px-3 pb-3"
      request={request}
      fullHeight
      forceUpdateKey={forceUpdateKey}
      tabsStorageKey="proxy_request_tabs"
      bodyLoader={loader}
      extraTabs={extraTabs}
      defaultTab={defaultTab}
      activeTab={activeTab}
      onTabChange={onTabChange}
      urlLine={<UrlLine flow={flow} />}
      renderBody={() => (
        <FlowRequestBody
          body={body}
          // The response's viewer choice, with the form's fields as a URL-encoded body's
          // formatted view, the switch in one bar with their bulk-view toggle
          viewer={
            <FlowBodyViewer
              flow={flow}
              which="request"
              form={
                request.bodyType === BODY_TYPE_FORM_URLENCODED
                  ? (actions) => (
                      <FormUrlencodedEditor
                        readOnly
                        requestId={request.id}
                        form={request.body.form}
                        forceUpdateKey={forceUpdateKey}
                        actions={actions}
                      />
                    )
                  : undefined
              }
              hideCutNote
            />
          }
          requestSize={flow.requestSize}
        />
      )}
    />
  );
}

/** The method and URL, at the status line's height so the two header lines align */
function UrlLine({ flow }: { flow: Flow }) {
  return (
    // The whole URL on hover, when it runs past the card
    <Tooltip wrap onlyWhenTruncated content={flow.url} delay={CONTROL_TOOLTIP_DELAY}>
      <div
        className={classNames(
          "flex items-center gap-2 min-h-[calc(var(--height-sm)+0.25rem)] -mb-1.5",
          "font-mono text-sm whitespace-nowrap overflow-x-auto hide-scrollbars",
        )}
      >
        <span className="text-text-subtle shrink-0">{flow.method}</span>
        <span className="text-text select-text cursor-text">{flow.url}</span>
      </div>
    </Tooltip>
  );
}

function FlowResponseHalf({ flow, className }: { flow: Flow; className: string }) {
  // A stream's body is its messages, read by the Messages tab; reading it whole again on every
  // message would only hold copies of it
  const loadBody = flow.streamKind == null;
  const body = useLoadedBody(flow, "response", loadBody);
  const response = useMemo(() => flowResponseToView(flow, body.data ?? null), [flow, body.data]);
  const loader = useMemo(
    () =>
      flowBodyLoader({
        useBody: () => useLoadedBody(flow, "response", loadBody),
        contentType: findHeader(flow.responseHeaders, "content-type"),
      }),
    [flow, loadBody],
  );
  const openSave = useSetAtom(saveDialogFlowAtom);
  const flowActions = useFlowActions();
  const messagesLabel = messagesTabLabel(flow);

  const extraTabs = useMemo<ExtraPaneTab[]>(
    () => [
      {
        tab: { value: RESPONSE_TAB_TIMELINE, label: "Timeline" },
        content: <FlowTimeline flow={flow} />,
      },
      { tab: { value: RESPONSE_TAB_INFO, label: "Info" }, content: <FlowInfo flow={flow} /> },
      ...(messagesLabel == null
        ? []
        : [
            {
              tab: {
                value: RESPONSE_TAB_MESSAGES,
                label: messagesLabel,
                rightSlot: (
                  <CountBadge
                    count={flow.messageCount}
                    color="info"
                    showZero
                    className="tabular-nums"
                  />
                ),
              },
              content: <FlowMessages flow={flow} />,
            },
          ]),
    ],
    [flow, messagesLabel],
  );
  const available = [
    RESPONSE_TAB_BODY,
    RESPONSE_TAB_HEADERS,
    RESPONSE_TAB_COOKIES,
    RESPONSE_TAB_TIMELINE,
    RESPONSE_TAB_INFO,
    ...(messagesLabel == null ? [] : [RESPONSE_TAB_MESSAGES]),
  ];
  const { activeTab, defaultTab, onTabChange } = useShapeTab("response", flow, available);
  const saved = flow.savedRequestId != null;

  return (
    <HttpResponsePaneView
      bare
      requestShownApart
      className={classNames(className, "border-border-subtle")}
      response={response}
      body={loader}
      requestBody={null}
      emptyState={<EmptyStateText>Waiting for a response</EmptyStateText>}
      tabsStorageKey="proxy_response_tabs"
      activeTabKey={flow.id}
      defaultTab={defaultTab}
      activeTab={activeTab}
      onTabChange={onTabChange}
      extraTabs={extraTabs}
      renderBodyViewer={() => <FlowBodyViewer flow={flow} which="response" />}
      statusLineCenter={
        flow.responseTruncated ? (
          <span
            className={classNames(
              "justify-self-end flex items-center gap-1.5 h-5 px-2.5 ml-3 rounded-full",
              "border border-notice/50 text-notice font-sans text-xs",
            )}
          >
            <Icon icon="scissors" size="xs" />
            {body.data == null ? "Body cut" : `First ${formatSize(body.data.storedSize)} kept`}
          </span>
        ) : undefined
      }
      statusLineRight={
        <div className="flex items-center gap-0.5 m-0.5">
          <IconButton
            size="sm"
            icon="bookmark"
            iconColor={saved ? "primary" : "secondary"}
            title={saved ? "Saved to Yaak" : "Save to Yaak"}
            tooltip
            onClick={() => openSave(flow)}
          />
          <Dropdown items={flowActions(flow).slice(2)}>
            <IconButton size="sm" icon="ellipsis" iconColor="secondary" title="Actions" tooltip />
          </Dropdown>
        </div>
      }
    />
  );
}
