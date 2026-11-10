import { useSetAtom } from "jotai";
import { useEffect, useLayoutEffect, useState } from "react";
import { AddColumnDialog } from "../components/AddColumnDialog";
import { FlowDetail } from "../components/FlowDetail";
import { FlowList } from "../components/FlowList";
import { selectedFlowAtom } from "../lib/atoms";
import { browserTabMemory, learnedTabKey, flowShape } from "../lib/defaultTab";
import { flowWindowAtom } from "../lib/store";
import { type FlowFixture, fixtures } from "./fixtures";

/**
 * Dev only: captured flows in the detail card, over fixtures. Open
 * `/harness.html?flow=0&theme=dark`; `&list` puts the flow list beside the card (its halves
 * stacked), `&below` puts it above (side by side), and `&tab=info` opens the response half on a
 * tab, as though it were chosen by hand for flows of that shape.
 */
export function FlowPanesHarness() {
  const params = new URLSearchParams(location.search);
  const [index, setIndex] = useState(Number(params.get("flow") ?? 0));
  const fixture = fixtures[index] ?? fixtures[0];
  if (fixture == null) return null;

  return (
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
      <FixtureCard key={fixture.flow.id} fixture={fixture} />
      <AddColumnDialog />
    </div>
  );
}

function FixtureCard({ fixture }: { fixture: FlowFixture }) {
  const params = new URLSearchParams(location.search);
  const setSelected = useSetAtom(selectedFlowAtom);
  const setWindow = useSetAtom(flowWindowAtom);
  const [ready, setReady] = useState(false);
  useLayoutEffect(() => {
    const flows = fixtures.map((f, i) => ({ ...f.flow, number: 1401 + i }));
    const tab = params.get("tab");
    if (tab != null) {
      browserTabMemory()?.setItem(learnedTabKey("response", flowShape(fixture.flow)), tab);
    }
    setWindow({ flows, hasOlder: false, total: flows.length });
    setSelected(flows.find((f) => f.id === fixture.flow.id) ?? fixture.flow);
    setReady(true);
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- once per fixture
  }, [fixture]);

  // `&arrive=3`: that many new flows, one a second, as traffic would bring them
  useEffect(() => {
    const count = Number(params.get("arrive") ?? 0);
    let added = 0;
    const timer = setInterval(() => {
      if (added >= count) return clearInterval(timer);
      added++;
      const source = fixtures[added % fixtures.length]?.flow;
      if (source == null) return;
      const flow = {
        ...source,
        // The fixture's id first, so the backend finds its bodies, as `manyFlows` does
        id: `${source.id}~arrived_${added}`,
        number: 1500 + added,
        startedAt: new Date().toISOString().slice(0, 23),
      };
      setWindow((w) => ({ ...w, flows: [...w.flows, flow], total: w.total + 1 }));
    }, 1000);
    return () => clearInterval(timer);
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- once per fixture
  }, [fixture]);
  if (!ready) return null;

  if (params.has("list")) {
    return (
      <div className="h-full min-h-0 grid grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <FlowList className="min-h-0" />
        <FlowDetail sideBySide />
      </div>
    );
  }
  if (params.has("below")) {
    return (
      <div className="h-full min-h-0 grid grid-rows-[minmax(0,0.45fr)_minmax(0,0.55fr)]">
        <FlowList className="min-h-0" />
        <FlowDetail sideBySide={false} />
      </div>
    );
  }
  return <FlowDetail sideBySide={false} />;
}
