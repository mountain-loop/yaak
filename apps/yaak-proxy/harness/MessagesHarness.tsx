import { useSetAtom } from "jotai";
import { useLayoutEffect, useMemo, useState } from "react";
import { FlowDetail } from "../components/FlowDetail";
import { ProxyEditorHost } from "../components/ProxyEditorHost";
import { MessageSourceContext } from "../hooks/useFlowMessages";
import { selectedFlowAtom } from "../lib/atoms";
import { fixtureSource, type StreamFixture, streamFixtures } from "./streamFixtures";

/**
 * Dev only: a streaming flow's detail, opened on its Messages tab, over fixtures served the way
 * the engine serves them. Open `/harness.html?stream=0&theme=dark`.
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

function StreamDetail({ fixture }: { fixture: StreamFixture }) {
  const source = useMemo(() => fixtureSource(fixture), [fixture]);
  const setSelected = useSetAtom(selectedFlowAtom);
  const [flow, setFlow] = useState(fixture.flow);
  useLayoutEffect(() => setSelected(flow), [flow, setSelected]);
  // The count on the flow follows its messages, as the engine writes it
  useLayoutEffect(
    () => source.subscribe(() => setFlow((f) => ({ ...f, messageCount: f.messageCount + 1 }))),
    [source],
  );
  return (
    <MessageSourceContext.Provider value={source}>
      <FlowDetail sideBySide={false} />
    </MessageSourceContext.Provider>
  );
}
