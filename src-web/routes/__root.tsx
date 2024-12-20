import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { createRootRoute, Outlet } from '@tanstack/react-router';
import classNames from 'classnames';
import { MotionConfig } from 'framer-motion';
import React, { Suspense } from 'react';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { HelmetProvider } from 'react-helmet-async';
import { DialogProvider, Dialogs } from '../components/DialogContext';
import { GlobalHooks } from '../components/GlobalHooks';
import { ToastProvider, Toasts } from '../components/ToastContext';
import { useOsInfo } from '../hooks/useOsInfo';

const ENABLE_REACT_QUERY_DEVTOOLS = true;

const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (err, query) => {
      console.log('Query client error', { err, query });
    },
  }),
  defaultOptions: {
    queries: {
      retry: false,
      networkMode: 'always',
      refetchOnWindowFocus: true,
      refetchOnReconnect: false,
      refetchOnMount: false, // Don't refetch when a hook mounts
    },
  },
});

const TanStackRouterDevtools =
  process.env.NODE_ENV === 'production'
    ? () => null // Render nothing in production
    : React.lazy(() =>
        import('@tanstack/router-devtools').then((res) => ({
          default: res.TanStackRouterDevtools,
        })),
      );

export const Route = createRootRoute({
  component: RouteComponent,
});

function RouteComponent() {
  const osInfo = useOsInfo();
  return (
    <QueryClientProvider client={queryClient}>
      {ENABLE_REACT_QUERY_DEVTOOLS && <ReactQueryDevtools buttonPosition="bottom-left" />}
      <MotionConfig transition={{ duration: 0.1 }}>
        <HelmetProvider>
          <DndProvider backend={HTML5Backend}>
            <Suspense>
              <DialogProvider>
                <ToastProvider>
                  <>
                    {/* Must be inside all the providers, so they have access to them */}
                    <Toasts />
                    <Dialogs />
                  </>
                  <div
                    className={classNames(
                      'w-full h-full',
                      osInfo?.osType === 'linux' && 'border border-border-subtle',
                    )}
                  >
                    <Outlet />
                  </div>
                  <GlobalHooks />
                </ToastProvider>
              </DialogProvider>
            </Suspense>
          </DndProvider>
        </HelmetProvider>
      </MotionConfig>
      <TanStackRouterDevtools initialIsOpen />
    </QueryClientProvider>
  );
}
