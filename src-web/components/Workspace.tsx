import { workspacesAtom } from '@yaakapp-internal/models';
import classNames from 'classnames';
import { useAtomValue } from 'jotai';
import * as m from 'motion/react-m';
import type { CSSProperties } from 'react';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  useEnsureActiveCookieJar,
  useSubscribeActiveCookieJarId,
} from '../hooks/useActiveCookieJar';
import {
  activeEnvironmentAtom,
  useSubscribeActiveEnvironmentId,
} from '../hooks/useActiveEnvironment';
import { activeFolderAtom } from '../hooks/useActiveFolder';
import { useSubscribeActiveFolderId } from '../hooks/useActiveFolderId';
import { activeRequestAtom } from '../hooks/useActiveRequest';
import { useSubscribeActiveRequestId } from '../hooks/useActiveRequestId';
import { activeWorkspaceAtom } from '../hooks/useActiveWorkspace';
import { useFloatingSidebarHidden } from '../hooks/useFloatingSidebarHidden';
import { useHotKey } from '../hooks/useHotKey';
import { useSubscribeRecentCookieJars } from '../hooks/useRecentCookieJars';
import { useSubscribeRecentEnvironments } from '../hooks/useRecentEnvironments';
import { useSubscribeRecentRequests } from '../hooks/useRecentRequests';
import { useSubscribeRecentWorkspaces } from '../hooks/useRecentWorkspaces';
import { useShouldFloatSidebar } from '../hooks/useShouldFloatSidebar';
import { useSidebarHidden } from '../hooks/useSidebarHidden';
import { useSidebarWidth } from '../hooks/useSidebarWidth';
import { useSyncWorkspaceRequestTitle } from '../hooks/useSyncWorkspaceRequestTitle';
import { duplicateRequestOrFolderAndNavigate } from '../lib/duplicateRequestOrFolderAndNavigate';
import { importData } from '../lib/importData';
import { jotaiStore } from '../lib/jotai';
import { Banner } from './core/Banner';
import { Button } from './core/Button';
import { HotKeyList } from './core/HotKeyList';
import { FeedbackLink } from './core/Link';
import { HStack } from './core/Stacks';
import { CreateDropdown } from './CreateDropdown';
import { ErrorBoundary } from './ErrorBoundary';
import { FolderLayout } from './FolderLayout';
import { GrpcConnectionLayout } from './GrpcConnectionLayout';
import { HeaderSize } from './HeaderSize';
import { HttpRequestLayout } from './HttpRequestLayout';
import { Overlay } from './Overlay';
import type { ResizeHandleEvent } from './ResizeHandle';
import { ResizeHandle } from './ResizeHandle';
import Sidebar from './Sidebar';
import { SidebarActions } from './SidebarActions';
import { WebsocketRequestLayout } from './WebsocketRequestLayout';
import { WorkspaceHeader } from './WorkspaceHeader';

const side = { gridArea: 'side' };
const head = { gridArea: 'head' };
const body = { gridArea: 'body' };
const drag = { gridArea: 'drag' };

export function Workspace() {
  // First, subscribe to some things applicable to workspaces
  useGlobalWorkspaceHooks();

  const workspaces = useAtomValue(workspacesAtom);
  const [width, setWidth, resetWidth] = useSidebarWidth();
  const [sidebarHidden, setSidebarHidden] = useSidebarHidden();
  const [floatingSidebarHidden, setFloatingSidebarHidden] = useFloatingSidebarHidden();
  const activeEnvironment = useAtomValue(activeEnvironmentAtom);
  const floating = useShouldFloatSidebar();
  const [isResizing, setIsResizing] = useState<boolean>(false);
  const startWidth = useRef<number | null>(null);

  const handleResizeMove = useCallback(
    async ({ x, xStart }: ResizeHandleEvent) => {
      if (width == null || startWidth.current == null) return;

      const newWidth = startWidth.current + (x - xStart);
      if (newWidth < 50) {
        await setSidebarHidden(true);
        resetWidth();
      } else {
        await setSidebarHidden(false);
        setWidth(newWidth);
      }
    },
    [width, setSidebarHidden, resetWidth, setWidth],
  );

  const handleResizeStart = useCallback(() => {
    startWidth.current = width ?? null;
    setIsResizing(true);
  }, [width]);

  const handleResizeEnd = useCallback(() => {
    setIsResizing(false);
    startWidth.current = null;
  }, []);

  const sideWidth = sidebarHidden ? 0 : width;
  const styles = useMemo<CSSProperties>(
    () => ({
      gridTemplate: floating
        ? `
        ' ${head.gridArea}' auto
        ' ${body.gridArea}' minmax(0,1fr)
        / 1fr`
        : `
        ' ${head.gridArea} ${head.gridArea} ${head.gridArea}' auto
        ' ${side.gridArea} ${drag.gridArea} ${body.gridArea}' minmax(0,1fr)
        / ${sideWidth}px   0                1fr`,
    }),
    [sideWidth, floating],
  );

  const environmentBgStyle = useMemo(() => {
    if (activeEnvironment?.color == null) return undefined;
    const background = `linear-gradient(to right, ${activeEnvironment.color} 15%, transparent 40%)`;
    return { background };
  }, [activeEnvironment?.color]);

  // We're loading still
  if (workspaces.length === 0) {
    return null;
  }

  return (
    <div
      style={styles}
      className={classNames(
        'grid w-full h-full',
        // Animate sidebar width changes but only when not resizing
        // because it's too slow to animate on mouse move
        !isResizing && 'transition-grid',
      )}
    >
      {floating ? (
        <Overlay
          open={!floatingSidebarHidden}
          portalName="sidebar"
          onClose={() => setFloatingSidebarHidden(true)}
        >
          <m.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            className={classNames(
              'x-theme-sidebar',
              'absolute top-0 left-0 bottom-0 bg-surface border-r border-border-subtle w-[14rem]',
              'grid grid-rows-[auto_1fr]',
            )}
          >
            <HeaderSize size="lg" className="border-transparent">
              <SidebarActions />
            </HeaderSize>
            <ErrorBoundary name="Sidebar (Floating)">
              <Sidebar />
            </ErrorBoundary>
          </m.div>
        </Overlay>
      ) : (
        <>
          <div style={side} className={classNames('x-theme-sidebar', 'overflow-hidden bg-surface')}>
            <ErrorBoundary name="Sidebar">
              <Sidebar className="border-r border-border-subtle" />
            </ErrorBoundary>
          </div>
          <ResizeHandle
            style={drag}
            className="-translate-x-[1px]"
            justify="end"
            side="right"
            onResizeStart={handleResizeStart}
            onResizeEnd={handleResizeEnd}
            onResizeMove={handleResizeMove}
            onReset={resetWidth}
          />
        </>
      )}
      <HeaderSize
        data-tauri-drag-region
        size="lg"
        className="relative x-theme-appHeader bg-surface"
        style={head}
      >
        <div className="absolute inset-0 pointer-events-none">
          <div // Add subtle background
            style={environmentBgStyle}
            className="absolute inset-0 opacity-5"
          />
          <div // Add a subtle border bottom
            style={environmentBgStyle}
            className="absolute left-0 right-0 bottom-0 h-[0.5px] opacity-20"
          />
        </div>
        <WorkspaceHeader className="pointer-events-none" />
      </HeaderSize>
      <ErrorBoundary name="Workspace Body">
        <WorkspaceBody />
      </ErrorBoundary>
    </div>
  );
}

function WorkspaceBody() {
  const activeRequest = useAtomValue(activeRequestAtom);
  const activeFolder = useAtomValue(activeFolderAtom);
  const activeWorkspace = useAtomValue(activeWorkspaceAtom);

  if (activeWorkspace == null) {
    return (
      <m.div
        className="m-auto"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        // Delay the entering because the workspaces might load after a slight delay
        transition={{ delay: 0.5 }}
      >
        <Banner color="warning" className="max-w-[30rem]">
          The active workspace was not found. Select a workspace from the header menu or report this
          bug to <FeedbackLink />
        </Banner>
      </m.div>
    );
  }

  if (activeRequest?.model === 'grpc_request') {
    return <GrpcConnectionLayout style={body} />;
  } else if (activeRequest?.model === 'websocket_request') {
    return <WebsocketRequestLayout style={body} activeRequest={activeRequest} />;
  } else if (activeRequest?.model === 'http_request') {
    return <HttpRequestLayout activeRequest={activeRequest} style={body} />;
  } else if (activeFolder != null) {
    return <FolderLayout folder={activeFolder} style={body} />;
  }

  return (
    <HotKeyList
      hotkeys={['model.create', 'sidebar.focus', 'settings.show']}
      bottomSlot={
        <HStack space={1} justifyContent="center" className="mt-3">
          <Button variant="border" size="sm" onClick={() => importData.mutate()}>
            Import
          </Button>
          <CreateDropdown hideFolder>
            <Button variant="border" forDropdown size="sm">
              New Request
            </Button>
          </CreateDropdown>
        </HStack>
      }
    />
  );
}

function useGlobalWorkspaceHooks() {
  useEnsureActiveCookieJar();

  useSubscribeActiveRequestId();
  useSubscribeActiveFolderId();
  useSubscribeActiveEnvironmentId();
  useSubscribeActiveCookieJarId();

  useSubscribeRecentRequests();
  useSubscribeRecentWorkspaces();
  useSubscribeRecentEnvironments();
  useSubscribeRecentCookieJars();

  useSyncWorkspaceRequestTitle();

  useHotKey('model.duplicate', () =>
    duplicateRequestOrFolderAndNavigate(jotaiStore.get(activeRequestAtom)),
  );
}
