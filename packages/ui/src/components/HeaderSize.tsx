import { useCapability } from "@yaakapp-internal/platform";
import classNames from "classnames";
import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { useMemo } from "react";
import { useIsFullscreen } from "../hooks/useIsFullscreen";
import { HEADER_SIZE_LG, HEADER_SIZE_MD, WINDOW_CONTROLS_WIDTH } from "../lib/constants";
import { WindowControls } from "./WindowControls";

interface HeaderSizeProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
  size: "md" | "lg";
  ignoreControlsSpacing?: boolean;
  onlyXWindowControl?: boolean;
  hideControls?: boolean;
  osType: string;
  hideWindowControls: boolean;
  useNativeTitlebar: boolean;
  interfaceScale: number;
}

export function HeaderSize({
  className,
  style,
  size,
  ignoreControlsSpacing,
  onlyXWindowControl,
  children,
  hideControls,
  osType,
  hideWindowControls,
  useNativeTitlebar,
  interfaceScale,
}: HeaderSizeProps) {
  const isFullscreen = useIsFullscreen();
  // The header only doubles as the titlebar when the host hands the page the
  // window frame (Tauri) and the user hasn't opted for the native one. In a
  // browser tab the frame is the browser's: no controls, no traffic lights.
  const drawsWindowChrome = useCapability("windowChrome") && !useNativeTitlebar;
  const finalStyle = useMemo<CSSProperties>(() => {
    const s = { ...style };

    // Set the height (use min-height because scaling font size may make it larger
    if (size === "md") s.minHeight = HEADER_SIZE_MD;
    if (size === "lg") s.minHeight = HEADER_SIZE_LG;

    if (!drawsWindowChrome) {
      // No style updates when something else draws the titlebar
    } else if (osType === "macos") {
      if (!isFullscreen) {
        // Add large padding for window controls
        s.paddingLeft = 76 / interfaceScale;
      }
    } else if (!ignoreControlsSpacing && !hideWindowControls) {
      s.paddingRight = WINDOW_CONTROLS_WIDTH;
    }

    return s;
  }, [
    ignoreControlsSpacing,
    isFullscreen,
    hideWindowControls,
    interfaceScale,
    size,
    style,
    drawsWindowChrome,
    osType,
  ]);

  return (
    <div
      data-tauri-drag-region
      style={finalStyle}
      className={classNames(
        className,
        "pt-px", // Make up for bottom border
        "select-none relative flex items-center",
        "w-full border-b border-border-subtle min-w-0",
      )}
    >
      {/* NOTE: This needs display:grid or else the element shrinks (even though scrollable) */}
      <div
        data-tauri-drag-region
        className={classNames(
          "pointer-events-none h-full w-full overflow-x-auto hide-scrollbars grid",
          "px-1", // Give it some space on either end for focus outlines
        )}
      >
        {children}
      </div>
      {!hideControls && drawsWindowChrome && (
        <WindowControls
          onlyX={onlyXWindowControl}
          osType={osType}
          hideWindowControls={hideWindowControls}
          useNativeTitlebar={useNativeTitlebar}
        />
      )}
    </div>
  );
}
