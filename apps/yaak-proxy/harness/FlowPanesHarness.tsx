import {
  HttpRequestPaneView,
  HttpResponsePaneView,
  type HttpBodyResult,
  type ResponseViewMode,
} from "@yaakapp-internal/ui";
import { useMemo, useState } from "react";
import { ProxyEditorHost } from "../components/ProxyEditorHost";
import { findHeader } from "../lib/body";
import {
  type FlowBodyData,
  flowBodyFromRpc,
  flowBodyLoader,
  flowRequestToView,
  flowResponseToView,
} from "../lib/flowViews";
import { type FlowFixture, fixtures } from "./fixtures";

/**
 * Dev only: renders captured flows through the shared request and response panes, read-only,
 * side by side, the way the proxy's detail view will. Open `/harness.html?flow=0&theme=dark`.
 */
export function FlowPanesHarness() {
  const params = new URLSearchParams(location.search);
  const [index, setIndex] = useState(Number(params.get("flow") ?? 0));
  const fixture = fixtures[index] ?? fixtures[0];
  if (fixture == null) return null;

  return (
    <ProxyEditorHost formatText={formatLocally}>
      <div className="h-full w-full grid grid-rows-[auto_minmax(0,1fr)] gap-2 p-2 bg-surface">
        <div className="flex gap-2 text-sm">
          {fixtures.map((f, i) => (
            <button
              key={f.flow.id}
              type="button"
              className={i === index ? "text-text" : "text-text-subtle"}
              onClick={() => setIndex(i)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <FlowPanes key={fixture.flow.id} fixture={fixture} />
      </div>
    </ProxyEditorHost>
  );
}

function FlowPanes({ fixture }: { fixture: FlowFixture }) {
  const { flow } = fixture;
  const [viewMode, setViewMode] = useState<ResponseViewMode>("pretty");
  const requestBody = useMemo(() => flowBodyFromRpc(fixture.requestBody), [fixture]);
  const responseBody = useMemo(() => flowBodyFromRpc(fixture.responseBody), [fixture]);
  const request = useMemo(() => flowRequestToView(flow, requestBody), [flow, requestBody]);
  const response = useMemo(() => flowResponseToView(flow), [flow]);

  const requestLoader = useMemo(
    () =>
      flowBodyLoader({
        useBody: () => loaded(requestBody),
        contentType: findHeader(flow.requestHeaders, "content-type"),
      }),
    [requestBody, flow],
  );
  const responseLoader = useMemo(
    () =>
      flowBodyLoader({
        useBody: () => loaded(responseBody),
        contentType: findHeader(flow.responseHeaders, "content-type"),
      }),
    [responseBody, flow],
  );

  return (
    <div className="grid grid-cols-2 gap-2 min-h-0">
      <div className="min-h-0 px-2">
        <HttpRequestPaneView
          request={request}
          fullHeight
          forceUpdateKey={flow.updatedAt}
          tabsStorageKey="flow_request_tabs"
          bodyLoader={requestLoader}
        />
      </div>
      <HttpResponsePaneView
        response={response}
        body={responseLoader}
        requestBody={requestLoader}
        emptyState={<div className="p-3 text-text-subtle">Waiting for a response</div>}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        tabsStorageKey="flow_response_tabs"
        activeTabKey={flow.id}
        onCopyAsCurl={() => undefined}
      />
    </div>
  );
}

function loaded(data: FlowBodyData): HttpBodyResult<FlowBodyData | null> {
  return { data, isLoading: false, error: null };
}

/** The engine formats JSON over RPC, which a page outside the app can't reach */
async function formatLocally(text: string, language: unknown): Promise<string> {
  if (language !== "json") return text;
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}
