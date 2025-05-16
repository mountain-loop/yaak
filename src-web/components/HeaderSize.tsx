import { settingsAtom } from '@yaakapp-internal/models';
import classNames from 'classnames';
import { useAtomValue } from 'jotai';
import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';
import React, { useMemo } from 'react';
import { useStoplightsVisible } from '../hooks/useStoplightsVisible';
import { HEADER_SIZE_LG, HEADER_SIZE_MD, WINDOW_CONTROLS_WIDTH } from '../lib/constants';
import { WindowControls } from './WindowControls';

interface HeaderSizeProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
  size: 'md' | 'lg';
  ignoreControlsSpacing?: boolean;
  onlyXWindowControl?: boolean;
}

export function HeaderSize({
  className,
  style,
  size,
  ignoreControlsSpacing,
  onlyXWindowControl,
  children,
}: HeaderSizeProps) {
  const settings = useAtomValue(settingsAtom);
  const stoplightsVisible = useStoplightsVisible();
  const finalStyle = useMemo<CSSProperties>(() => {
    const s = { ...style };

    // Set the height (use min-height because scaling font size may make it larger
    if (size === 'md') s.minHeight = HEADER_SIZE_MD;
    if (size === 'lg') s.minHeight = HEADER_SIZE_LG;

    // Add large padding for window controls
    if (stoplightsVisible && !ignoreControlsSpacing) {
      s.paddingLeft = 72 / settings.interfaceScale;
    } else if (!stoplightsVisible && !ignoreControlsSpacing && !settings.hideWindowControls) {
      s.paddingRight = WINDOW_CONTROLS_WIDTH;
    }

    return s;
  }, [
    ignoreControlsSpacing,
    settings.hideWindowControls,
    settings.interfaceScale,
    size,
    stoplightsVisible,
    style,
  ]);

  return (
    <div
      data-tauri-drag-region
      style={finalStyle}
      className={classNames(
        className,
        'px-1', // Give it some space on either end
        'pt-[1px]', // Make up for bottom border
        'select-none relative',
        'w-full border-b border-border-subtle min-w-0',
      )}
    >
      {/* NOTE: This needs display:grid or else the element shrinks (even though scrollable) */}
      <div className="pointer-events-none h-full w-full overflow-x-auto hide-scrollbars grid">
        {children}
      </div>
      <WindowControls onlyX={onlyXWindowControl} />
    </div>
  );
}
