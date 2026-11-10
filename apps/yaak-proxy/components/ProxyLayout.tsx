import {
  HeaderSize,
  HeaderTint,
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
import { setupIncomplete } from "../lib/firstRun";
import { useMenuExportHar } from "../lib/flowActions";
import { useNavigationControls } from "../lib/navigation";
import { proxyStatusOf, statusTintColor } from "../lib/proxyStatus";
import { lockedAtom, noFlowsAtom, proxyStateAtom, systemProxyEverOnAtom } from "../lib/store";
import { getOsType } from "../lib/tauri";
import { AddColumnDialog } from "./AddColumnDialog";
import { ClearFlowsButton } from "./ClearFlowsButton";
import { FirstRun } from "./FirstRun";
import { FlowDetail } from "./FlowDetail";
import { FlowList } from "./FlowList";
import { LockedState } from "./LockedState";
import { ProxyStatus, useProxySetup } from "./ProxyStatus";
import { HelperDialog } from "./HelperDialog";
import { SaveDialog } from "./SaveDialog";
import { SavedSearchDialog } from "./SavedSearchDialog";
import { SearchBar } from "./SearchBar";
import { SettingsDialogFallback, useOpenSettings } from "./Settings";
import { Sidebar } from "./Sidebar";
import { TakeOverBanner } from "./TakeOverBanner";

export function ProxyLayout() {
  const os = getOsType();
  const [flowLayout, setFlowLayout] = useAtom(flowLayoutAtom);
  const openSettings = useOpenSettings();
  useMenuExportHar();
  useNavigationControls();
  const [sidebarWidth, setSidebarWidth] = useLocalStorage("sidebar_width", 250);
  const [sidebarHidden, setSidebarHidden] = useLocalStorage("sidebar_hidden", false);
  const [floatingSidebarHidden, setFloatingSidebarHidden] = useLocalStorage(
    "floating_sidebar_hidden",
    true,
  );
  const [floating, setFloating] = useState(false);
  const isHidden = floating ? (floatingSidebarHidden ?? true) : (sidebarHidden ?? false);
  const tint = statusTintColor(proxyStatusOf(useAtomValue(proxyStateAtom)));

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
        <HeaderTint color={tint} animate />
        {/* Yaak's silhouette: the sidebar toggle and the state pill where Yaak has the toggle and
            the environment, the search where it names the request, then its icons. Only the
            controls take the pointer: everything around them, the traffic lights' corner
            included, falls through to the header, which drags the window. */}
        <div
          data-tauri-drag-region
          className="grid grid-cols-[minmax(auto,1fr)_minmax(0,44rem)_minmax(auto,1fr)] gap-2 items-center w-full h-full pointer-events-none"
        >
          <div data-tauri-drag-region className="flex items-center gap-1 pl-1 whitespace-nowrap">
            <IconButton
              className="pointer-events-auto"
              size="sm"
              title="Toggle sidebar"
              tooltip
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
            <ProxyStatus />
          </div>
          <div data-tauri-drag-region className="min-w-0">
            <div className="pointer-events-auto">
              <SearchBar />
            </div>
          </div>
          <div data-tauri-drag-region className="flex items-center justify-end gap-1 pr-1">
            <ClearFlowsButton />
            <IconButton
              className="pointer-events-auto"
              icon={flowLayout === "horizontal" ? "columns_2" : "rows_2"}
              title={`Change to ${flowLayout === "horizontal" ? "vertical" : "horizontal"} layout`}
              tooltip
              size="sm"
              iconColor="secondary"
              onClick={() =>
                setFlowLayout((prev) => (prev === "horizontal" ? "vertical" : "horizontal"))
              }
            />
            <IconButton
              className="pointer-events-auto"
              icon="settings"
              title="Settings"
              tooltip
              size="sm"
              iconColor="secondary"
              onClick={() => openSettings()}
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
                  tooltip
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
      <SavedSearchDialog />
      <AddColumnDialog />
      <HelperDialog />
      <SettingsDialogFallback />
      <Toasts />
    </div>
  );
}

/**
 * The flow list beside or above the detail pane, or, while setup is incomplete and there are no
 * flows, the first-run card across the whole area. Once setup is done an empty list says so
 * itself, after a Clear too. While captured traffic is locked, the locked state takes the whole
 * area, or the first-run card does, saying why, while setup is incomplete too.
 */
function FlowsOrFirstRun({ flowLayout }: { flowLayout: SplitLayoutLayout }) {
  const locked = useAtomValue(lockedAtom);
  const noFlows = useAtomValue(noFlowsAtom) || locked != null;
  const { systemProxy } = useProxySetup();
  const systemProxyEverOn = useAtomValue(systemProxyEverOnAtom);
  const incomplete = setupIncomplete({
    systemProxySupported: systemProxy.data?.supported ?? null,
    systemProxyEverOn,
  });
  if (noFlows && incomplete) return <FirstRun />;
  if (locked != null) return <LockedState lock={locked} />;
  return (
    <SplitLayout
      storageKey="proxy_detail"
      // The card sits a wider gutter from the list side by side; the handle fills the gutter.
      gutter={flowLayout === "vertical" ? 8 : 20}
      layout={flowLayout}
      defaultRatio={0.55}
      firstSlot={({ style }) => <FlowList style={style} className="pt-1" />}
      secondSlot={({ style, orientation }) => (
        <FlowDetail style={style} sideBySide={orientation === "horizontal"} />
      )}
    />
  );
}
