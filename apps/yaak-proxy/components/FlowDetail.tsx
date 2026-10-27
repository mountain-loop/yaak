import { formatSize } from "@yaakapp-internal/lib/formatSize";
import type { Flow } from "@yaakapp-internal/proxy-lib";
import {
  Banner,
  Button,
  CountBadge,
  Dropdown,
  type DropdownItem,
  formatMillis,
  HStack,
  HttpStatusTagRaw,
  Icon,
  SizeTag,
  type TabButtonRenderProps,
  type TabItem,
  TabContent,
  Tabs,
} from "@yaakapp-internal/ui";
import classNames from "classnames";
import { atom, useAtomValue } from "jotai";
import type { CSSProperties } from "react";
import { useMemo, useState } from "react";
import { selectedFlowIdAtom } from "../lib/atoms";
import { findHeader, mimeEssence } from "../lib/body";
import { statusReason } from "../lib/statusReason";
import { flowsAtom } from "../lib/store";
import { EmptyState, FlowBodyViewer, useFlowBody } from "./FlowBodyViewer";
import { FlowHeaders, FlowQuery, queryParams } from "./FlowHeaders";

const selectedFlowAtom = atom((get) => {
  const id = get(selectedFlowIdAtom);
  return id == null ? null : (get(flowsAtom).find((f) => f.id === id) ?? null);
});

const TAB_RESPONSE = "response";
const TAB_REQUEST = "request";
const TAB_HEADERS = "headers";
const TAB_QUERY = "query";

export function FlowDetail({ style, sideBySide }: { style?: CSSProperties; sideBySide: boolean }) {
  const flow = useAtomValue(selectedFlowAtom);

  return (
    <div
      style={style}
      className={classNames("min-h-0 min-w-0 pb-2", sideBySide ? "pr-2 pt-2" : "px-2")}
    >
      <div
        className={classNames(
          "x-theme-responsePane",
          "h-full bg-surface rounded-md border border-border-subtle overflow-hidden",
        )}
      >
        {flow == null ? (
          <EmptyState>
            <div className="grid grid-cols-[auto_auto] gap-x-6 gap-y-2 text-left">
              <span>Select a flow</span>
              <Keys keys={["↑", "↓"]} />
              <span>Start the proxy</span>
              <Keys keys={["⌘", "⇧", "P"]} />
              <span>Stop the proxy</span>
              <Keys keys={["⌘", "⇧", "S"]} />
            </div>
          </EmptyState>
        ) : (
          <FlowPane flow={flow} />
        )}
      </div>
    </div>
  );
}

function FlowPane({ flow }: { flow: Flow }) {
  const [pretty, setPretty] = useState(true);
  const responseBody = useFlowBody(flow, "response", flow.responseTruncated);
  // Failed before any response; an error after the headers is a body cut short mid-way.
  const noResponse = flow.error != null && flow.status == null;
  const mime = mimeEssence(findHeader(flow.responseHeaders, "content-type"));
  const queryCount = useMemo(() => queryParams(flow.url).length, [flow.url]);

  const tabs = useMemo<TabItem[]>(
    () => [
      {
        value: TAB_RESPONSE,
        renderButton: ({ buttonProps, isActive }) => (
          <ViewModeButton
            buttonProps={buttonProps}
            isActive={isActive}
            pretty={pretty}
            onChangePretty={setPretty}
            prettyLabel={mime === "text/html" ? "Preview" : "Response"}
            allowRaw={!mime?.startsWith("image/")}
          />
        ),
      },
      {
        value: TAB_REQUEST,
        label: "Request",
        rightSlot: flow.requestSize > 0 ? <CountBadge count={true} /> : null,
      },
      {
        value: TAB_HEADERS,
        label: "Headers",
        rightSlot: (
          <CountBadge
            count={flow.requestHeaders.length}
            count2={flow.responseHeaders.length}
            showZero
          />
        ),
      },
      {
        value: TAB_QUERY,
        label: "Query",
        rightSlot: <CountBadge count={queryCount} showZero />,
      },
    ],
    [
      pretty,
      mime,
      flow.requestSize,
      flow.requestHeaders.length,
      flow.responseHeaders.length,
      queryCount,
    ],
  );

  return (
    <div className="h-full w-full grid grid-rows-[auto_minmax(0,1fr)] grid-cols-1">
      <div
        className={classNames(
          "grid grid-cols-[auto_minmax(4rem,1fr)] items-center h-sm -mb-1.5",
          "cursor-default select-none whitespace-nowrap w-full px-3",
          "overflow-x-auto font-mono text-sm text-text-subtle hide-scrollbars",
        )}
      >
        <HStack space={2} className="w-full shrink-0">
          <HttpStatusTagRaw
            showReason
            status={flow.status ?? 0}
            statusReason={flow.status == null ? null : statusReason(flow.status)}
          />
          {flow.elapsedMs != null && (
            <>
              <span>&bull;</span>
              <span
                title={
                  flow.elapsedHeadersMs == null
                    ? undefined
                    : `HEADERS: ${formatMillis(flow.elapsedHeadersMs)}\nTOTAL: ${formatMillis(flow.elapsedMs)}`
                }
              >
                {formatMillis(flow.elapsedMs)}
              </span>
            </>
          )}
          {!noResponse && (
            <>
              <span>&bull;</span>
              <SizeTag contentLength={flow.responseSize} />
            </>
          )}
        </HStack>
        {flow.responseTruncated ? (
          <span
            className={classNames(
              "justify-self-end flex items-center gap-1.5 h-5 px-2.5 ml-3 rounded-full",
              "border border-notice/50 text-notice font-sans text-xs",
            )}
          >
            <Icon icon="scissors" size="xs" />
            {responseBody.data == null
              ? "Body cut"
              : `First ${formatSize(responseBody.data.storedSize)} kept`}
          </span>
        ) : (
          <span />
        )}
      </div>

      <div className="overflow-hidden flex flex-col min-h-0">
        {flow.error != null && (
          <Banner color="danger" className="mx-3 mt-1 shrink-0 font-mono text-sm">
            {flow.error}
          </Banner>
        )}
        <Tabs
          tabs={tabs}
          label="Flow"
          className="ml-3 mr-3 mb-3 min-h-0 flex-1"
          tabListClassName="mt-0.5 -mb-1.5"
        >
          <TabContent value={TAB_RESPONSE}>
            {noResponse ? (
              <EmptyState>
                <div className="text-text-subtle mb-1">No response</div>
                <div className="text-xs">
                  The request never got a response. The Request tab has what the app sent.
                </div>
              </EmptyState>
            ) : (
              <FlowBodyViewer flow={flow} which="response" pretty={pretty} />
            )}
          </TabContent>
          <TabContent value={TAB_REQUEST}>
            <FlowBodyViewer flow={flow} which="request" pretty />
          </TabContent>
          <TabContent value={TAB_HEADERS}>
            <FlowHeaders flow={flow} />
          </TabContent>
          <TabContent value={TAB_QUERY}>
            <FlowQuery flow={flow} />
          </TabContent>
        </Tabs>
      </div>
    </div>
  );
}

interface ViewModeButtonProps {
  buttonProps: TabButtonRenderProps["buttonProps"];
  isActive: boolean;
  pretty: boolean;
  onChangePretty: (pretty: boolean) => void;
  prettyLabel: string;
  allowRaw: boolean;
}

/** The client's Response tab: a click on the active tab opens its view menu */
function ViewModeButton({
  buttonProps,
  isActive,
  pretty,
  onChangePretty,
  prettyLabel,
  allowRaw,
}: ViewModeButtonProps) {
  const showPretty = pretty || !allowRaw;
  const items: DropdownItem[] = [
    {
      label: prettyLabel,
      leftSlot: <CheckMark visible={showPretty} />,
      onSelect: () => onChangePretty(true),
    },
    {
      label: `${prettyLabel} (Raw)`,
      hidden: !allowRaw,
      leftSlot: <CheckMark visible={!showPretty} />,
      onSelect: () => onChangePretty(false),
    },
  ];

  return (
    <Dropdown items={items}>
      <Button
        {...buttonProps}
        onClick={(e) => {
          if (isActive) return;
          e.preventDefault();
          buttonProps.onClick?.(e);
        }}
        rightSlot={
          <Icon
            size="sm"
            icon="chevron_down"
            className={classNames("ml-1", isActive ? "text-text-subtle" : "text-text-subtlest")}
          />
        }
      >
        {showPretty ? prettyLabel : "Raw"}
      </Button>
    </Dropdown>
  );
}

function CheckMark({ visible }: { visible: boolean }) {
  return <Icon icon={visible ? "check" : "empty"} size="sm" />;
}

function Keys({ keys }: { keys: string[] }) {
  return (
    <span className="flex gap-1 justify-end">
      {keys.map((k) => (
        <kbd
          key={k}
          className="min-w-5 h-5 px-1 grid place-items-center rounded-sm border border-border-subtle font-sans text-xs text-text-subtle"
        >
          {k}
        </kbd>
      ))}
    </span>
  );
}
