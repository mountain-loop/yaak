import { HeaderSize } from '@yaakapp-internal/ui';
import classNames from 'classnames';
import { useAtomValue } from 'jotai';
import { useRpcQueryWithEvent } from '../hooks/useRpcQueryWithEvent';
import { getOsType } from '../lib/tauri';
import { ActionIconButton } from './ActionIconButton';
import { ExchangesTable } from './ExchangesTable';
import { filteredExchangesAtom, Sidebar } from './Sidebar';

export function ProxyLayout() {
  const os = getOsType();
  const exchanges = useAtomValue(filteredExchangesAtom);
  const { data: proxyState } = useRpcQueryWithEvent('get_proxy_state', {}, 'proxy_state_changed');
  const isRunning = proxyState?.state === 'running';

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
        <div className="grid grid-cols-[minmax(0,1fr)_auto]">
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
      <div className="grid grid-cols-[auto_1fr] min-h-0">
        <Sidebar />
        <main className="overflow-auto">
          <ExchangesTable exchanges={exchanges} />
        </main>
      </div>
    </div>
  );
}
