import classNames from "classnames";
import type { ReactNode } from "react";
import { useEditorHost } from "../EditorHost";
import { HeaderSize } from "../HeaderSize";
import { Icon, type IconProps } from "../Icon";
import { HStack } from "../Stacks";
import { TabContent, type TabItem, Tabs } from "../tabs/Tabs";

export const SETTINGS_TAB_GENERAL = "general";
export const SETTINGS_TAB_THEME = "theme";
export const SETTINGS_TAB_INTERFACE = "interface";
export const SETTINGS_TAB_LICENSE = "license";

/** A tab in the settings rail, with what it shows */
export interface SettingsTabDef {
  value: string;
  label: string;
  icon: IconProps["icon"];
  hidden?: boolean;
  /** A count or dot beside the label */
  rightSlot?: ReactNode;
  content: ReactNode;
  /** Replaces the scrolling, padded default, for tabs that lay themselves out */
  contentClassName?: string;
}

/** What the window's own title bar needs, when settings is a window rather than a dialog */
export interface SettingsTitlebar {
  osType: string;
  hideWindowControls: boolean;
  useNativeTitlebar: boolean;
  interfaceScale: number;
}

export interface SettingsDialogProps {
  tabs: SettingsTabDef[];
  defaultTab?: string;
  /** The window's title bar; null in a dialog, which has its own frame */
  titlebar: SettingsTitlebar | null;
  title?: string;
}

const DEFAULT_CONTENT_CLASS = "overflow-y-auto h-full px-6 py-4!";

/**
 * Yaak's settings: a title bar, the tabs down the left with their icons, and the active tab's
 * content. Each app passes the tabs it has, shared ones and its own, in the order it wants.
 */
export function SettingsDialog({
  tabs,
  defaultTab,
  titlebar,
  title = "Settings",
}: SettingsDialogProps) {
  const { ErrorBoundary } = useEditorHost();
  return (
    <div className={classNames("grid grid-rows-[auto_minmax(0,1fr)] h-full")}>
      {titlebar == null ? (
        <span />
      ) : (
        <HeaderSize
          data-tauri-drag-region
          ignoreControlsSpacing
          onlyXWindowControl
          size="md"
          className="x-theme-appHeader bg-surface text-text-subtle flex items-center justify-center border-b border-border-subtle text-sm font-semibold"
          osType={titlebar.osType}
          hideWindowControls={titlebar.hideWindowControls}
          useNativeTitlebar={titlebar.useNativeTitlebar}
          interfaceScale={titlebar.interfaceScale}
        >
          <HStack
            space={2}
            justifyContent="center"
            className="w-full h-full grid grid-cols-[1fr_auto] pointer-events-none"
          >
            <div className={classNames(titlebar.osType === "macos" ? "text-center" : "pl-2")}>
              {title}
            </div>
          </HStack>
        </HeaderSize>
      )}
      <Tabs
        layout="horizontal"
        defaultValue={defaultTab}
        addBorders
        tabListClassName="min-w-40 bg-surface x-theme-sidebar border-r border-border pl-3"
        label={title}
        tabs={tabs.map((tab): TabItem => ({
          value: tab.value,
          label: tab.label,
          hidden: tab.hidden,
          leftSlot: <Icon icon={tab.icon} className="text-secondary" />,
          rightSlot: tab.rightSlot ?? null,
        }))}
      >
        {tabs.map((tab) => (
          <TabContent
            key={tab.value}
            value={tab.value}
            className={tab.contentClassName ?? DEFAULT_CONTENT_CLASS}
            ErrorBoundary={ErrorBoundary}
          >
            {tab.content}
          </TabContent>
        ))}
      </Tabs>
    </div>
  );
}
