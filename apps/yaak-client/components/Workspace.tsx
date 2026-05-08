import { type } from "@tauri-apps/plugin-os";
import { settingsAtom, workspacesAtom } from "@yaakapp-internal/models";
import { Banner, HeaderSize, HStack, SidebarLayout } from "@yaakapp-internal/ui";
import classNames from "classnames";
import { useAtomValue } from "jotai";
import * as m from "motion/react-m";
import { useMemo, useState } from "react";
import {
  useEnsureActiveCookieJar,
  useSubscribeActiveCookieJarId,
} from "../hooks/useActiveCookieJar";
import {
  activeEnvironmentAtom,
  useSubscribeActiveEnvironmentId,
} from "../hooks/useActiveEnvironment";
import { activeFolderAtom } from "../hooks/useActiveFolder";
import { useSubscribeActiveFolderId } from "../hooks/useActiveFolderId";
import { activeRequestAtom } from "../hooks/useActiveRequest";
import { useSubscribeActiveRequestId } from "../hooks/useActiveRequestId";
import { activeWorkspaceAtom } from "../hooks/useActiveWorkspace";
import { useFloatingSidebarHidden } from "../hooks/useFloatingSidebarHidden";
import { useHotKey } from "../hooks/useHotKey";
import { useSubscribeRecentCookieJars } from "../hooks/useRecentCookieJars";
import { useSubscribeRecentEnvironments } from "../hooks/useRecentEnvironments";
import { useSubscribeRecentRequests } from "../hooks/useRecentRequests";
import { useSubscribeRecentWorkspaces } from "../hooks/useRecentWorkspaces";
import { useSidebarHidden } from "../hooks/useSidebarHidden";
import { useSidebarWidth } from "../hooks/useSidebarWidth";
import { useSyncWorkspaceRequestTitle } from "../hooks/useSyncWorkspaceRequestTitle";
import { duplicateRequestOrFolderAndNavigate } from "../lib/duplicateRequestOrFolderAndNavigate";
import { importData } from "../lib/importData";
import { jotaiStore } from "../lib/jotai";
import { CreateDropdown } from "./CreateDropdown";
import { Button } from "./core/Button";
import { HotkeyList } from "./core/HotkeyList";
import { FeedbackLink } from "./core/Link";
import { ErrorBoundary } from "./ErrorBoundary";
import { FolderLayout } from "./FolderLayout";
import { GrpcConnectionLayout } from "./GrpcConnectionLayout";
import { HttpRequestLayout } from "./HttpRequestLayout";
import Sidebar from "./Sidebar";
import { SidebarActions } from "./SidebarActions";
import { WebsocketRequestLayout } from "./WebsocketRequestLayout";
import { WorkspaceHeader } from "./WorkspaceHeader";

const body = { gridArea: "body" };

export function Workspace() {
  // First, subscribe to some things applicable to workspaces
  useGlobalWorkspaceHooks();

  const workspaces = useAtomValue(workspacesAtom);
  const settings = useAtomValue(settingsAtom);
  const osType = type();
  const [width, setWidth] = useSidebarWidth();
  const [sidebarHidden, setSidebarHidden] = useSidebarHidden();
  const [floatingSidebarHidden, setFloatingSidebarHidden] = useFloatingSidebarHidden();
  const activeEnvironment = useAtomValue(activeEnvironmentAtom);
  const [floating, setFloating] = useState(false);

  const environmentBgStyle = useMemo(() => {
    if (activeEnvironment?.color == null) return undefined;
    const background = `linear-gradient(to right, ${activeEnvironment.color} 15%, transparent 40%)`;
    return { background };
  }, [activeEnvironment?.color]);

  // We're loading still
  if (workspaces.length === 0) {
    return null;
  }

  const header = (
    <HeaderSize
      data-tauri-drag-region
      size="lg"
      className="relative x-theme-appHeader bg-surface"
      osType={osType}
      hideWindowControls={settings.hideWindowControls}
      useNativeTitlebar={settings.useNativeTitlebar}
      interfaceScale={settings.interfaceScale}
    >
      <div className="absolute inset-0 pointer-events-none">
        <div style={environmentBgStyle} className="absolute inset-0 opacity-[0.07]" />
        <div
          style={environmentBgStyle}
          className="absolute left-0 right-0 -bottom-[1px] h-[1px] opacity-20"
        />
      </div>
      <WorkspaceHeader className="pointer-events-none" floatingSidebar={floating} />
    </HeaderSize>
  );

  const workspaceBody = (
    <ErrorBoundary name="Workspace Body">
      <WorkspaceBody />
    </ErrorBoundary>
  );

  const sidebarContent = floating ? (
    <div
      className={classNames(
        "x-theme-sidebar",
        "h-full bg-surface border-r border-border-subtle",
        "grid grid-rows-[auto_1fr]",
      )}
    >
      <HeaderSize
        hideControls
        size="lg"
        className="border-transparent flex items-center"
        osType={osType}
        hideWindowControls={settings.hideWindowControls}
        useNativeTitlebar={settings.useNativeTitlebar}
        interfaceScale={settings.interfaceScale}
      >
        <SidebarActions floating />
      </HeaderSize>
      <ErrorBoundary name="Sidebar (Floating)">
        <Sidebar />
      </ErrorBoundary>
    </div>
  ) : (
    <div className="x-theme-sidebar overflow-hidden bg-surface h-full">
      <ErrorBoundary name="Sidebar">
        <Sidebar className="border-r border-border-subtle" />
      </ErrorBoundary>
    </div>
  );

  return (
    <div className="grid w-full h-full grid-rows-[auto_1fr]">
      {header}
      <SidebarLayout
        width={width ?? 250}
        onWidthChange={setWidth}
        hidden={sidebarHidden ?? false}
        onHiddenChange={(hidden) => setSidebarHidden(hidden)}
        floatingHidden={floatingSidebarHidden ?? true}
        onFloatingHiddenChange={(hidden) => setFloatingSidebarHidden(hidden)}
        onFloatingChange={setFloating}
        sidebar={sidebarContent}
      >
        {workspaceBody}
      </SidebarLayout>
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

  if (activeRequest?.model === "grpc_request") {
    return <GrpcConnectionLayout style={body} />;
  }
  if (activeRequest?.model === "websocket_request") {
    return <WebsocketRequestLayout style={body} activeRequest={activeRequest} />;
  }
  if (activeRequest?.model === "http_request") {
    return <HttpRequestLayout activeRequest={activeRequest} style={body} />;
  }
  if (activeFolder != null) {
    return <FolderLayout folder={activeFolder} style={body} />;
  }

  return (
    <HotkeyList
      hotkeys={["model.create", "sidebar.focus", "settings.show"]}
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

  useHotKey("model.duplicate", () =>
    duplicateRequestOrFolderAndNavigate(jotaiStore.get(activeRequestAtom)),
  );
}
