import { settingsAtom } from '@yaakapp-internal/models';
import classNames from 'classnames';
import { useAtomValue } from 'jotai';
import type { HTMLAttributes, ReactNode } from 'react';
import React from 'react';
import { useOsInfo } from '../hooks/useOsInfo';
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
  const osInfo = useOsInfo();
  const settings = useAtomValue(settingsAtom);
  const stoplightsVisible = useStoplightsVisible();
  return (
    <div
      data-tauri-drag-region
      style={{
        ...style,
        // Add padding for macOS stoplights, but keep it the same width (account for the interface scale)
        paddingLeft:
          stoplightsVisible && !ignoreControlsSpacing ? 72 / settings.interfaceScale : undefined,
        ...(size === 'md' ? { minHeight: HEADER_SIZE_MD } : {}),
        ...(size === 'lg' ? { minHeight: HEADER_SIZE_LG } : {}),
        ...(osInfo.osType === 'macos' || ignoreControlsSpacing
          ? { paddingRight: '2px' }
          : { paddingLeft: '2px', paddingRight: WINDOW_CONTROLS_WIDTH }),
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
      <WindowControls onlyX={onlyXWindowControl} />
    </div>
  );
}
