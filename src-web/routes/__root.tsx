import { QueryClientProvider } from '@tanstack/react-query';
import { createRootRoute, Outlet } from '@tanstack/react-router';
import { type } from '@tauri-apps/plugin-os';
import classNames from 'classnames';
import { Provider as JotaiProvider } from 'jotai';
import { domAnimation, LazyMotion, MotionConfig } from 'motion/react';
import React, { Suspense } from 'react';
import { DndProvider } from 'react-dnd';
import { TouchBackend } from 'react-dnd-touch-backend';
import { Dialogs } from '../components/Dialogs';
import { GlobalHooks } from '../components/GlobalHooks';
import RouteError from '../components/RouteError';
import { Toasts } from '../components/Toasts';
import { jotaiStore } from '../lib/jotai';
import { queryClient } from '../lib/queryClient';

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
            <DndProvider backend={TouchBackend} options={{ enableMouseEvents: true }}>
              <Suspense>
                <GlobalHooks />
                <Toasts />
                <Dialogs />
                <Layout />
              </Suspense>
            </DndProvider>
          </MotionConfig>
        </LazyMotion>
      </QueryClientProvider>
    </JotaiProvider>
  );
}

function Layout() {
  return (
    <div
      className={classNames('w-full h-full', type() === 'linux' && 'border border-border-subtle')}
    >
      <Outlet />
    </div>
  );
}
