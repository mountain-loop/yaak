import { QueryClientProvider } from '@tanstack/react-query';
import { createRootRoute, Outlet } from '@tanstack/react-router';
import classNames from 'classnames';
import { Provider as JotaiProvider } from 'jotai';
import { domAnimation, LazyMotion, MotionConfig } from 'motion/react';
import React, { Suspense } from 'react';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { HelmetProvider } from 'react-helmet-async';
import { Dialogs } from '../components/Dialogs';
import { GlobalHooks } from '../components/GlobalHooks';
import RouteError from '../components/RouteError';
import { Toasts } from '../components/Toasts';
import { useOsInfo } from '../hooks/useOsInfo';
import { jotaiStore } from '../lib/jotai';
import { queryClient } from '../lib/queryClient';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const TanStackRouterDevtools =
  process.env.NODE_ENV === 'production'
    ? () => null // Render nothing in production
    : React.lazy(() =>
        import('@tanstack/router-devtools').then((res) => ({
          default: res.TanStackRouterDevtools,
        })),
      );

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const ReactQueryDevtools =
  process.env.NODE_ENV === 'production'
    ? () => null // Render nothing in production
    : React.lazy(() =>
        import('@tanstack/react-query-devtools').then((res) => ({
          default: res.ReactQueryDevtools,
        })),
      );

export const Route = createRootRoute({
  component: RouteComponent,
  errorComponent: RouteError,
});

function RouteComponent() {
  const osInfo = useOsInfo();
  return (
    <JotaiProvider store={jotaiStore}>
      <QueryClientProvider client={queryClient}>
        <LazyMotion features={domAnimation}>
          <MotionConfig transition={{ duration: 0.1 }}>
            <HelmetProvider>
              <DndProvider backend={HTML5Backend}>
                <Suspense>
                  <GlobalHooks />
                  <Toasts />
                  <Dialogs />
                  <div
                    className={classNames(
                      'w-full h-full',
                      osInfo?.osType === 'linux' && 'border border-border-subtle',
                    )}
                  >
                    <Outlet />
                  </div>
                </Suspense>
              </DndProvider>
            </HelmetProvider>
          </MotionConfig>
        </LazyMotion>
        {/*<ReactQueryDevtools initialIsOpen />*/}
        {/*<TanStackRouterDevtools initialIsOpen />*/}
      </QueryClientProvider>
    </JotaiProvider>
  );
}
