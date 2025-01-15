import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import classNames from 'classnames';
import React, { useState } from 'react';
import { useOsInfo } from '../hooks/useOsInfo';
import {WINDOW_CONTROLS_WIDTH} from "../lib/constants";
import { Button } from './core/Button';
import { HStack } from './core/Stacks';

interface Props {
  className?: string;
  onlyX?: boolean;
  macos?: boolean;
}

export function WindowControls({ className, onlyX }: Props) {
  const [maximized, setMaximized] = useState<boolean>(false);
  const osInfo = useOsInfo();

  // Never show controls on macOS
  if (osInfo.osType === 'macos') {
    return null;
  }

  return (
    <HStack
      className={classNames(className, 'ml-4 absolute right-0 top-0 bottom-0')}
      justifyContent="end"
      style={{ width: WINDOW_CONTROLS_WIDTH }}
      data-tauri-drag-region
    >
      {!onlyX && (
        <>
          <Button
            className="!h-full px-4 text-text-subtle hocus:text hocus:bg-surface-highlight rounded-none"
            color="custom"
            onClick={() => getCurrentWebviewWindow().minimize()}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">
              <path fill="currentColor" d="M14 8v1H3V8z" />
            </svg>
          </Button>
          <Button
            className="!h-full px-4 text-text-subtle hocus:text hocus:bg-surface-highlight rounded-none"
            color="custom"
            onClick={async () => {
              const w = getCurrentWebviewWindow();
              const isMaximized = await w.isMaximized();
              if (isMaximized) {
                await w.unmaximize();
                setMaximized(false);
              } else {
                await w.maximize();
                setMaximized(true);
              }
              console.log("TOGGLE", isMaximized);
            }}
          >
            {maximized ? (
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">
                <g fill="currentColor">
                  <path d="M3 5v9h9V5zm8 8H4V6h7z" />
                  <path fillRule="evenodd" d="M5 5h1V4h7v7h-1v1h2V3H5z" clipRule="evenodd" />
                </g>
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">
                <path fill="currentColor" d="M3 3v10h10V3zm9 9H4V4h8z" />
              </svg>
            )}
          </Button>
        </>
      )}
      <Button
        color="custom"
        className="!h-full px-4 text-text-subtle rounded-none hocus:bg-danger hocus:text-text"
        onClick={() => getCurrentWebviewWindow().close()}
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">
          <path
            fill="currentColor"
            fillRule="evenodd"
            d="m7.116 8l-4.558 4.558l.884.884L8 8.884l4.558 4.558l.884-.884L8.884 8l4.558-4.558l-.884-.884L8 7.116L3.442 2.558l-.884.884z"
            clipRule="evenodd"
          />
        </svg>
      </Button>
    </HStack>
  );
}
