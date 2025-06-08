import { QueryClientProvider } from '@tanstack/react-query';
import { createRootRoute, Outlet } from '@tanstack/react-router';
import { settingsAtom } from '@yaakapp-internal/models';
import classNames from 'classnames';
import { Provider as JotaiProvider, useAtomValue } from 'jotai';
import { domAnimation, LazyMotion, MotionConfig } from 'motion/react';
import React, { Suspense } from 'react';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { HelmetProvider } from 'react-helmet-async';
import { Dialogs } from '../components/Dialogs';
import { GlobalHooks } from '../components/GlobalHooks';
import RouteError from '../components/RouteError';
import { Toasts } from '../components/Toasts';
import { jotaiStore } from '../lib/jotai';
import { queryClient } from '../lib/queryClient';
import { type } from '@tauri-apps/plugin-os';

export const Route = createRootRoute({
  component: RouteComponent,
  errorComponent: RouteError,
});

function RouteComponent() {
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
                  <Layout />
                </Suspense>
              </DndProvider>
            </HelmetProvider>
          </MotionConfig>
        </LazyMotion>
      </QueryClientProvider>
    </JotaiProvider>
  );
}

function Layout() {
  const settings = useAtomValue(settingsAtom);
  return (
    <div
      className={classNames('w-full h-full', type() === 'linux' && 'border border-border-subtle')}
      style={{ fontFamily: settings.interfaceFont ?? undefined }}
    >
      <Outlet />
    </div>
  );
}
