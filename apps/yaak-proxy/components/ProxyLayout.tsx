import {
  HeaderSize,
  IconButton,
  SidebarLayout,
  SplitLayout,
  type SplitLayoutLayout,
  Toasts,
} from "@yaakapp-internal/ui";
import classNames from "classnames";
import { useAtom, useAtomValue } from "jotai";
import { useState } from "react";
import { useLocalStorage } from "react-use";
import { flowLayoutAtom } from "../lib/atoms";
import { searchWindowAtom, showFirstRunAtom, shownTotalAtom } from "../lib/store";
import { getOsType } from "../lib/tauri";
import { ClearFlowsButton } from "./ClearFlowsButton";
import { FirstRun } from "./FirstRun";
import { FlowDetail } from "./FlowDetail";
import { FlowList } from "./FlowList";
import { ProxyStatus } from "./ProxyStatus";
import { SaveDialog } from "./SaveDialog";
import { selectedSidebarLabelAtom, Sidebar } from "./Sidebar";
import { TakeOverBanner } from "./TakeOverBanner";

export function ProxyLayout() {
  const os = getOsType();
  const title = useAtomValue(selectedSidebarLabelAtom);
  const [flowLayout, setFlowLayout] = useAtom(flowLayoutAtom);
  const [sidebarWidth, setSidebarWidth] = useLocalStorage("sidebar_width", 250);
  const [sidebarHidden, setSidebarHidden] = useLocalStorage("sidebar_hidden", false);
  const [floatingSidebarHidden, setFloatingSidebarHidden] = useLocalStorage(
    "floating_sidebar_hidden",
    true,
  );
  const [floating, setFloating] = useState(false);
  const isHidden = floating ? (floatingSidebarHidden ?? true) : (sidebarHidden ?? false);

  return (
    <div
      className={classNames(
        "h-full w-full grid grid-rows-[auto_minmax(0,1fr)]",
        os === "linux" && "border border-border-subtle",
      )}
    >
      <HeaderSize
        data-tauri-drag-region
        size="lg"
        osType={os}
        hideWindowControls={false}
        useNativeTitlebar={false}
        interfaceScale={1}
        className="x-theme-appHeader bg-surface"
      >
        <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center w-full h-full pointer-events-none">
          <div className="flex items-center pl-1 pointer-events-auto">
            <IconButton
              size="sm"
              title="Toggle sidebar"
              icon={isHidden ? "left_panel_hidden" : "left_panel_visible"}
              iconColor="secondary"
              onClick={() => {
                if (floating) {
                  setFloatingSidebarHidden(!floatingSidebarHidden);
                } else {
                  setSidebarHidden(!sidebarHidden);
                }
              }}
            />
          </div>
          <div
            data-tauri-drag-region
            className="pointer-events-none flex items-center justify-center gap-2 text-sm px-2 min-w-0"
          >
            <span className="truncate">{title}</span>
            <FlowCount />
          </div>
          <div className="flex items-center gap-1 pr-1">
            <ProxyStatus />
            <ClearFlowsButton />
            <IconButton
              className="pointer-events-auto"
              icon={flowLayout === "horizontal" ? "columns_2" : "rows_2"}
              title={`Change to ${flowLayout === "horizontal" ? "vertical" : "horizontal"} layout`}
              size="sm"
              iconColor="secondary"
              onClick={() =>
                setFlowLayout((prev) => (prev === "horizontal" ? "vertical" : "horizontal"))
              }
            />
          </div>
        </div>
      </HeaderSize>
      <SidebarLayout
        width={sidebarWidth ?? 250}
        onWidthChange={setSidebarWidth}
        hidden={sidebarHidden ?? false}
        onHiddenChange={setSidebarHidden}
        floatingHidden={floatingSidebarHidden ?? true}
        onFloatingHiddenChange={setFloatingSidebarHidden}
        onFloatingChange={setFloating}
        sidebar={
          floating ? (
            <div
              className={classNames(
                "x-theme-sidebar",
                "h-full bg-surface border-r border-border-subtle",
                "grid grid-rows-[auto_1fr]",
              )}
            >
              <HeaderSize
                hideControls
                size="lg"
                className="border-transparent pl-1"
                osType={os}
                hideWindowControls={false}
                useNativeTitlebar={false}
                interfaceScale={1}
              >
                <IconButton
                  size="sm"
                  title="Toggle sidebar"
                  icon="left_panel_visible"
                  iconColor="secondary"
                  onClick={() => setFloatingSidebarHidden(true)}
                />
              </HeaderSize>
              <Sidebar />
            </div>
          ) : (
            <Sidebar />
          )
        }
      >
        <div className="h-full flex flex-col min-h-0">
          <TakeOverBanner />
          <div className="flex-1 min-h-0 grid grid-rows-[minmax(0,1fr)]">
            <FlowsOrFirstRun flowLayout={flowLayout} />
          </div>
        </div>
      </SidebarLayout>
      <SaveDialog />
      <Toasts />
    </div>
  );
}

/** Its own component, so new traffic re-renders the count rather than the whole layout */
function FlowCount() {
  const count = useAtomValue(shownTotalAtom);
  const searching = useAtomValue(searchWindowAtom) != null;
  const noun = searching ? (count === 1 ? "match" : "matches") : count === 1 ? "flow" : "flows";
  return <span className="text-text-subtlest shrink-0">{`${count} ${noun}`}</span>;
}

/**
 * The flow list above the detail pane, or, while the database has no flows at all, the first-run
 * card across the whole area: it is the empty state until traffic replaces it.
 */
function FlowsOrFirstRun({ flowLayout }: { flowLayout: SplitLayoutLayout }) {
  if (useAtomValue(showFirstRunAtom)) return <FirstRun />;
  return (
    <SplitLayout
      storageKey="proxy_detail"
      className="gap-1"
      layout={flowLayout}
      defaultRatio={0.55}
      firstSlot={({ style, orientation }) => (
        <FlowList sideBySide={orientation === "horizontal"} style={style} className="pt-1" />
      )}
      secondSlot={({ style, orientation }) => (
        <FlowDetail style={style} sideBySide={orientation === "horizontal"} />
      )}
    />
  );
}
