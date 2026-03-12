import { HeaderSize, IconButton, SidebarLayout } from '@yaakapp-internal/ui';
import classNames from 'classnames';
import { useAtomValue } from 'jotai';
import { useState } from 'react';
import { useLocalStorage } from 'react-use';
import { useRpcQueryWithEvent } from '../hooks/useRpcQueryWithEvent';
import { getOsType } from '../lib/tauri';
import { ActionIconButton } from './ActionIconButton';
import { ExchangesTable } from './ExchangesTable';
import { filteredExchangesAtom, Sidebar } from './Sidebar';

export function ProxyLayout() {
  const os = getOsType();
  const exchanges = useAtomValue(filteredExchangesAtom);
  const [sidebarWidth, setSidebarWidth] = useLocalStorage('sidebar_width', 250);
  const [sidebarHidden, setSidebarHidden] = useLocalStorage('sidebar_hidden', false);
  const [floatingSidebarHidden, setFloatingSidebarHidden] = useLocalStorage(
    'floating_sidebar_hidden',
    true,
  );
  const [floating, setFloating] = useState(false);
  const { data: proxyState } = useRpcQueryWithEvent('get_proxy_state', {}, 'proxy_state_changed');
  const isRunning = proxyState?.state === 'running';
  const isHidden = floating ? (floatingSidebarHidden ?? true) : (sidebarHidden ?? false);

  return (
    <div
      className={classNames(
        'h-full w-full grid grid-rows-[auto_1fr]',
        os === 'linux' && 'border border-border-subtle',
      )}
    >
      <HeaderSize
        size="lg"
        osType={os}
        hideWindowControls={false}
        useNativeTitlebar={false}
        interfaceScale={1}
        className="x-theme-appHeader bg-surface"
      >
        <div className="grid grid-cols-[auto_minmax(0,1fr)_auto]">
          <div className="flex items-center pl-1">
            <IconButton
              size="sm"
              title="Toggle sidebar"
              icon={isHidden ? 'left_panel_hidden' : 'left_panel_visible'}
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
          <div data-tauri-drag-region className="flex items-center text-sm px-2">
            Yaak Proxy
          </div>
          <div className="flex items-center gap-1 pr-1">
            <span
              className={classNames('text-xs', isRunning ? 'text-success' : 'text-text-subtlest')}
            >
              {isRunning ? 'Running on :9090' : 'Stopped'}
            </span>
            {isRunning ? (
              <ActionIconButton
                action={{ scope: 'global', action: 'proxy_stop' }}
                icon="circle_stop"
                size="sm"
                iconColor="danger"
              />
            ) : (
              <ActionIconButton
                action={{ scope: 'global', action: 'proxy_start' }}
                icon="circle_play"
                size="sm"
                iconColor="success"
              />
            )}
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
                'x-theme-sidebar',
                'h-full bg-surface border-r border-border-subtle',
                'grid grid-rows-[auto_1fr]',
              )}
            >
              <HeaderSize
                hideControls
                size="lg"
                className="border-transparent flex items-center pl-1"
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
        <ExchangesTable exchanges={exchanges} className="overflow-auto h-full" />
      </SidebarLayout>
    </div>
  );
}
