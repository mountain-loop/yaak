import type { WebsocketRequest } from '@yaakapp-internal/models';
import classNames from 'classnames';
import type { CSSProperties } from 'react';
import React from 'react';
import { SplitLayout } from './core/SplitLayout';
import { WebsocketRequestPane } from './WebsocketRequestPane';
import { WebsocketResponsePane } from './WebsocketResponsePane';

interface Props {
  activeRequest: WebsocketRequest;
  style: CSSProperties;
}

export function WebsocketRequestLayout({ activeRequest, style }: Props) {
  return (
    <SplitLayout
      name="websocket_layout"
      className="p-3 gap-1.5"
      style={style}
      firstSlot={({ orientation, style }) => (
        <WebsocketRequestPane
          style={style}
          activeRequest={activeRequest}
          fullHeight={orientation === 'horizontal'}
        />
      )}
      secondSlot={({ style }) => (
        <div
          style={style}
          className={classNames(
            'x-theme-responsePane',
            'max-h-full h-full grid grid-rows-[minmax(0,1fr)] grid-cols-1',
            'bg-surface rounded-md border border-border-subtle',
            'shadow relative',
          )}
        >
          <WebsocketResponsePane activeRequest={activeRequest} />
        </div>
      )}
    />
  );
}
