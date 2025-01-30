import classNames from 'classnames';
import type { CSSProperties } from 'react';
import React from 'react';
import { useLatestWebsocketConnection } from '../hooks/useWebsocketConnections';
import { Banner } from './core/Banner';
import { HotKeyList } from './core/HotKeyList';
import { Icon } from './core/Icon';
import { HStack } from './core/Stacks';

interface Props {
  style?: CSSProperties;
  className?: string;
  activeRequestId: string;
}

export function WebsocketResponsePane({ style, className, activeRequestId }: Props) {
  const connection = useLatestWebsocketConnection(activeRequestId);
  const isLoading = connection !== null && connection.state !== 'closed';

  return (
    <div
      style={style}
      className={classNames(
        className,
        'x-theme-responsePane',
        'max-h-full h-full',
        'bg-surface rounded-md border border-border-subtle',
        'relative',
      )}
    >
      {connection == null ? (
        <HotKeyList
          hotkeys={['http_request.send', 'http_request.create', 'sidebar.focus', 'url_bar.focus']}
        />
      ) : (
        <div className="h-full w-full grid grid-rows-[auto_minmax(0,1fr)] grid-cols-1">
          <HStack
            className={classNames(
              'text-text-subtle w-full flex-shrink-0',
              // Remove a bit of space because the tabs have lots too
              '-mb-1.5',
            )}
          >
            {connection && (
              <HStack
                space={2}
                alignItems="center"
                className={classNames(
                  'cursor-default select-none',
                  'whitespace-nowrap w-full pl-3 overflow-x-auto font-mono text-sm',
                )}
              >
                {isLoading && <Icon size="sm" icon="refresh" spin />}
                {/*<span>&bull;</span>*/}
                {/*<DurationTag headers={0} total={connection.elapsed} />*/}

                <div className="ml-auto">
                  {/*<RecentResponsesDropdown*/}
                  {/*  responses={responses}*/}
                  {/*  activeResponse={activeResponse}*/}
                  {/*  onPinnedResponseId={setPinnedResponseId}*/}
                  {/*/>*/}
                </div>
              </HStack>
            )}
          </HStack>

          {connection?.error ? (
            <Banner color="danger" className="m-2">
              {connection.error}
            </Banner>
          ) : (
            <div>Hello</div>
          )}
        </div>
      )}
    </div>
  );
}
