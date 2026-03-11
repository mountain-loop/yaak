import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type } from '@tauri-apps/plugin-os';
import {
  HeaderSize,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  TruncatedWideTableCell,
} from '@yaakapp-internal/ui';
import classNames from 'classnames';
import { createStore, Provider, useAtomValue } from 'jotai';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ActionButton } from './ActionButton';
import { filteredExchangesAtom, Sidebar } from './Sidebar';
import './main.css';
import type { ProxyHeader } from '@yaakapp-internal/proxy-lib';
import { initHotkeys } from './hotkeys';
import { listen, rpc } from './rpc';
import { useRpcQueryWithEvent } from './rpc-hooks';
import { applyChange, dataAtom, replaceAll } from './store';

const queryClient = new QueryClient();
const jotaiStore = createStore();

// Load initial models from the database
rpc('list_models', {}).then((res) => {
  jotaiStore.set(dataAtom, (prev) => replaceAll(prev, 'http_exchange', res.httpExchanges));
});

// Register hotkeys from action metadata
initHotkeys();

// Subscribe to model change events from the backend
listen('model_write', (payload) => {
  jotaiStore.set(dataAtom, (prev) =>
    applyChange(prev, 'http_exchange', payload.model, payload.change),
  );
});

function App() {
  const osType = type();
  const exchanges = useAtomValue(filteredExchangesAtom);
  const { data: proxyState } = useRpcQueryWithEvent('get_proxy_state', {}, 'proxy_state_changed');
  const isRunning = proxyState?.state === 'running';

  return (
    <div
      className={classNames(
        'h-full w-full grid grid-rows-[auto_1fr]',
        osType === 'linux' && 'border border-border-subtle',
      )}
    >
      <HeaderSize
        size="lg"
        osType={osType}
        hideWindowControls={false}
        useNativeTitlebar={false}
        interfaceScale={1}
        className="x-theme-appHeader bg-surface"
      >
        <div
          data-tauri-drag-region
          className="flex items-center px-2 text-sm font-semibold text-text-subtle"
        >
          Yaak Proxy
        </div>
      </HeaderSize>
      <div className="grid grid-cols-[auto_1fr] min-h-0">
        <Sidebar />
        <main className="overflow-auto p-4">
          <div className="flex items-center gap-3 mb-4">
            <ActionButton
              action={{ scope: 'global', action: 'proxy_start' }}
              size="sm"
              tone="primary"
              disabled={isRunning}
            />
            <ActionButton
              action={{ scope: 'global', action: 'proxy_stop' }}
              size="sm"
              variant="border"
              disabled={!isRunning}
            />
            <span
              className={classNames(
                'text-xs font-medium',
                isRunning ? 'text-success' : 'text-text-subtlest',
              )}
            >
              {isRunning ? 'Running on :9090' : 'Stopped'}
            </span>
          </div>

          {exchanges.length === 0 ? (
            <p className="text-text-subtlest text-sm">No traffic yet</p>
          ) : (
            <Table scrollable>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Method</TableHeaderCell>
                  <TableHeaderCell>URL</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                  <TableHeaderCell>Type</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {exchanges.map((ex) => (
                  <TableRow key={ex.id}>
                    <TableCell className="font-mono text-2xs">{ex.method}</TableCell>
                    <TruncatedWideTableCell className="font-mono text-2xs">
                      {ex.url}
                    </TruncatedWideTableCell>
                    <TableCell>
                      <StatusBadge status={ex.resStatus} error={ex.error} />
                    </TableCell>
                    <TableCell className="text-text-subtle text-xs">
                      {getContentType(ex.resHeaders)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </main>
      </div>
    </div>
  );
}

function StatusBadge({ status, error }: { status: number | null; error: string | null }) {
  if (error) return <span className="text-xs text-danger">Error</span>;
  if (status == null) return <span className="text-xs text-text-subtlest">—</span>;

  const color =
    status >= 500
      ? 'text-danger'
      : status >= 400
        ? 'text-warning'
        : status >= 300
          ? 'text-notice'
          : 'text-success';

  return <span className={classNames('text-xs font-mono', color)}>{status}</span>;
}

function getContentType(headers: ProxyHeader[]): string {
  const ct = headers.find((h) => h.name.toLowerCase() === 'content-type')?.value;
  if (ct == null) return '—';
  // Strip parameters (e.g. "; charset=utf-8")
  return ct.split(';')[0]?.trim() ?? ct;
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <Provider store={jotaiStore}>
        <App />
      </Provider>
    </QueryClientProvider>
  </StrictMode>,
);
