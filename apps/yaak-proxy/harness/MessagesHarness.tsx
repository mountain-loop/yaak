import type { Flow } from "@yaakapp-internal/proxy-lib";
import { useSetAtom, useStore } from "jotai";
import { useLayoutEffect, useMemo, useState } from "react";
import { FlowDetail } from "../components/FlowDetail";
import { FlowList } from "../components/FlowList";
import { ProxyEditorHost } from "../components/ProxyEditorHost";
import { MessageSourceContext } from "../hooks/useFlowMessages";
import { goToPlace } from "../lib/navigation";
import { flowWindowAtom } from "../lib/store";
import { fixtureSource, type StreamFixture, streamFixtures } from "./streamFixtures";

/**
 * Dev only: a streaming flow's detail, opened on its Messages tab, over fixtures served the way
 * the engine serves them. Open `/harness.html?stream=0&theme=dark`; add `&list` for the flow list
 * beside it, holding every fixture's flow.
 */
export function MessagesHarness() {
  const params = new URLSearchParams(location.search);
  const [index, setIndex] = useState(Number(params.get("stream") ?? 0));
  const fixture = streamFixtures[index] ?? streamFixtures[0];
  if (fixture == null) return null;

  return (
    <ProxyEditorHost>
      <div className="h-full w-full grid grid-rows-[auto_minmax(0,1fr)] gap-2 p-2 bg-surface">
        <div className="flex gap-2 text-sm">
          {streamFixtures.map((f, i) => (
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
        <StreamDetail key={fixture.flow.id} fixture={fixture} />
      </div>
    </ProxyEditorHost>
  );
}

/** Each fixture's flow as the list holds it, one after another, the shown one as it is now */
function listedFlows(shown: Flow): Flow[] {
  return streamFixtures.map((f, i) => {
    const flow = f.flow.id === shown.id ? shown : f.flow;
    return { ...flow, number: 1410 + i, startedAt: `2026-11-05T21:41:1${i}.000` };
  });
}

function StreamDetail({ fixture }: { fixture: StreamFixture }) {
  const source = useMemo(() => fixtureSource(fixture), [fixture]);
  const store = useStore();
  const setWindow = useSetAtom(flowWindowAtom);
  const [flow, setFlow] = useState(fixture.flow);
  const withList = new URLSearchParams(location.search).has("list");
  useLayoutEffect(() => {
    const flows = listedFlows(flow);
    setWindow({ flows, hasOlder: false, total: flows.length });
    const shown = flows.find((f) => f.id === flow.id) ?? flow;
    goToPlace(store, "update", { selection: [shown.id], flow: shown });
  }, [flow, store, setWindow]);
  // The count on the flow follows its messages, as the engine writes it
  useLayoutEffect(
    () => source.subscribe(() => setFlow((f) => ({ ...f, messageCount: f.messageCount + 1 }))),
    [source],
  );
  return (
    <MessageSourceContext.Provider value={source}>
      {withList ? (
        <div className="h-full min-h-0 grid grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <FlowList className="min-h-0" />
          <FlowDetail sideBySide />
        </div>
      ) : (
        <FlowDetail sideBySide={false} />
      )}
    </MessageSourceContext.Provider>
  );
}
