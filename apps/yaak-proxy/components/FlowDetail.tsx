import classNames from "classnames";
import { useAtomValue } from "jotai";
import type { CSSProperties } from "react";
import { selectedFlowAtom } from "../lib/atoms";
import { EmptyState } from "./FlowBodyViewer";
import { FlowCard } from "./FlowCard";
import { NotDecrypted } from "./NotDecrypted";

/**
 * The detail pane: the selected flow's card, or what the pane holds before one is selected. The
 * split's gutter separates it from the list; side by side it sits a little under the header.
 */
export function FlowDetail({ style, sideBySide }: { style?: CSSProperties; sideBySide: boolean }) {
  const flow = useAtomValue(selectedFlowAtom);

  return (
    <div
      style={style}
      className={classNames("min-h-0 min-w-0 pb-2", sideBySide ? "pr-2 pt-3" : "px-2")}
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
              <span>Pause or resume recording</span>
              <Keys keys={["⌘", "R"]} />
              <span>Clear flows</span>
              <Keys keys={["⌘", "⇧", "K"]} />
            </div>
          </EmptyState>
        ) : flow.tunnelled ? (
          <NotDecrypted flow={flow} />
        ) : (
          <FlowCard flow={flow} listBeside={sideBySide} />
        )}
      </div>
    </div>
  );
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
