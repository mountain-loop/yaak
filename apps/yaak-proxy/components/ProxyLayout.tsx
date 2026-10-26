import { HeaderSize, IconButton, SidebarLayout, SplitLayout } from "@yaakapp-internal/ui";
import classNames from "classnames";
import { useAtom, useAtomValue } from "jotai";
import { useState } from "react";
import { useLocalStorage } from "react-use";
import { flowLayoutAtom } from "../lib/atoms";
import { getOsType } from "../lib/tauri";
import { FlowDetail } from "./FlowDetail";
import { FlowList } from "./FlowList";
import { ProxyStatus } from "./ProxyStatus";
import { filteredExchangesAtom, selectedSidebarLabelAtom, Sidebar } from "./Sidebar";

export function ProxyLayout() {
  const os = getOsType();
  const exchanges = useAtomValue(filteredExchangesAtom);
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
            <span className="text-text-subtlest shrink-0">
              {exchanges.length === 1 ? "1 flow" : `${exchanges.length} flows`}
            </span>
          </div>
          <div className="flex items-center gap-1 pr-1">
            <ProxyStatus />
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
        <SplitLayout
          storageKey="proxy_detail"
          className="gap-1"
          layout={flowLayout}
          defaultRatio={0.55}
          firstSlot={({ style, orientation }) => (
            <FlowList
              flows={exchanges}
              sideBySide={orientation === "horizontal"}
              style={style}
              className="pt-1"
            />
          )}
          secondSlot={({ style, orientation }) => (
            <FlowDetail style={style} sideBySide={orientation === "horizontal"} />
          )}
        />
      </SidebarLayout>
    </div>
  );
}
