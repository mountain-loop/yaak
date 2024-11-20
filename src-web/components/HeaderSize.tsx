import classNames from 'classnames';
import type { HTMLAttributes, ReactNode } from 'react';
import React from 'react';
import { useSettings } from '../hooks/useSettings';
import { useOsInfo } from '../hooks/useOsInfo';
import { useStoplightsVisible } from '../hooks/useStoplightsVisible';
import { WINDOW_CONTROLS_WIDTH, WindowControls } from './WindowControls';

interface HeaderSizeProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
  size: 'md' | 'lg';
  ignoreControlsSpacing?: boolean;
  onlyXWindowControl?: boolean;
}

export const HEADER_SIZE_MD = '27px';
export const HEADER_SIZE_LG = '38px';

export function HeaderSize({
  className,
  style,
  size,
  ignoreControlsSpacing,
  onlyXWindowControl,
  children,
}: HeaderSizeProps) {
  const osInfo = useOsInfo();
  const settings = useSettings();
  const stoplightsVisible = useStoplightsVisible();
  return (
    <div
      data-tauri-drag-region
      style={{
        ...style,
        // Add padding for macOS stoplights, but keep it the same width (account for the interface scale)
        paddingLeft: stoplightsVisible ? 72 / settings.interfaceScale : undefined,
        ...(size === 'md' ? { height: HEADER_SIZE_MD } : {}),
        ...(size === 'lg' ? { height: HEADER_SIZE_LG } : {}),
        ...(stoplightsVisible || ignoreControlsSpacing
          ? { paddingRight: '2px' }
          : { paddingLeft: '2px', paddingRight: osInfo.osType !== 'macos' ? WINDOW_CONTROLS_WIDTH : '2px' }),
      }}
      className={classNames(
        className,
        'select-none relative',
        'pt-[1px] w-full border-b border-border-subtle min-w-0',
      )}
    >
      {/* NOTE: This needs display:grid or else the element shrinks (even though scrollable) */}
      <div className="pointer-events-none h-full w-full overflow-x-auto hide-scrollbars grid">
        {children}
      </div>
      <WindowControls onlyX={onlyXWindowControl} macos={osInfo.osType === 'macos'} />
    </div>
  );
}
