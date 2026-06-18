import { HStack, Icon } from "@yaakapp-internal/ui";
import classNames from "classnames";
import { useAtom, useAtomValue } from "jotai";
import { memo } from "react";
import { patchModel } from "@yaakapp-internal/models";
import { activeWorkspaceAtom, activeWorkspaceMetaAtom } from "../hooks/useActiveWorkspace";
import { activeRequestAtom } from "../hooks/useActiveRequest";
import { useToggleCommandPalette } from "../hooks/useToggleCommandPalette";
import { workspaceLayoutAtom } from "../lib/atoms";
import { curlPanelRequestIdAtom, hideCurlPanel, showCurlPanel } from "../lib/curlPanel";
import { setupOrConfigureEncryption } from "../lib/setupOrConfigureEncryption";
import { CookieDropdown } from "./CookieDropdown";
import { IconButton } from "./core/IconButton";
import { PillButton } from "./core/PillButton";
import { EnvironmentActionsDropdown } from "./EnvironmentActionsDropdown";
import { ImportCurlButton } from "./ImportCurlButton";
import { LicenseBadge } from "./LicenseBadge";
import { RecentRequestsDropdown } from "./RecentRequestsDropdown";
import { SettingsDropdown } from "./SettingsDropdown";
import { SidebarActions } from "./SidebarActions";
import { WorkspaceActionsDropdown } from "./WorkspaceActionsDropdown";

interface Props {
  className?: string;
  floatingSidebar?: boolean;
}

export const WorkspaceHeader = memo(function WorkspaceHeader({
  className,
  floatingSidebar,
}: Props) {
  const togglePalette = useToggleCommandPalette();
  const [workspaceLayout, setWorkspaceLayout] = useAtom(workspaceLayoutAtom);
  const workspace = useAtomValue(activeWorkspaceAtom);
  const activeRequest = useAtomValue(activeRequestAtom);
  const curlPanelRequestId = useAtomValue(curlPanelRequestIdAtom);
  const workspaceMeta = useAtomValue(activeWorkspaceMetaAtom);
  const showCurlButton = activeRequest?.model === "http_request";
  const showSaveRequestButton =
    activeRequest?.model === "http_request" && activeRequest.isSaved !== true;
  const curlPanelOpen = showCurlButton && curlPanelRequestId === activeRequest.id;
  const showEncryptionSetup =
    workspace != null &&
    workspaceMeta != null &&
    workspace.encryptionKeyChallenge != null &&
    workspaceMeta.encryptionKey == null;

  return (
    <div
      className={classNames(
        className,
        "grid grid-cols-[auto_minmax(0,1fr)_auto] items-center w-full h-full",
      )}
    >
      <HStack space={0.5} className={classNames("flex-1 pointer-events-none")}>
        <SidebarActions floating={floatingSidebar} />
        <CookieDropdown />
        <HStack className="min-w-0">
          <WorkspaceActionsDropdown />
          <Icon icon="chevron_right" color="secondary" />
          <EnvironmentActionsDropdown className="w-auto pointer-events-auto" />
        </HStack>
      </HStack>
      <div className="pointer-events-none w-full max-w-[30vw] mx-auto flex justify-center">
        <RecentRequestsDropdown />
      </div>
      <div className="flex-1 flex gap-1 items-center h-full justify-end pointer-events-none pr-1">
        <ImportCurlButton />
        {showEncryptionSetup ? (
          <PillButton color="danger" onClick={setupOrConfigureEncryption}>
            Enter Encryption Key
          </PillButton>
        ) : (
          <LicenseBadge />
        )}
        {showCurlButton && (
          <IconButton
            icon="square_terminal"
            title="View Curl"
            size="sm"
            iconColor="secondary"
            onClick={() => (curlPanelOpen ? hideCurlPanel() : showCurlPanel(activeRequest.id))}
          />
        )}
        {showSaveRequestButton && (
          <IconButton
            icon="save"
            title="Save Request"
            size="sm"
            iconColor="secondary"
            onClick={() => patchModel(activeRequest, { isSaved: true })}
          />
        )}
        <IconButton
          icon={
            workspaceLayout === "responsive"
              ? "magic_wand"
              : workspaceLayout === "horizontal"
                ? "columns_2"
                : "rows_2"
          }
          title={`Change to ${workspaceLayout === "horizontal" ? "vertical" : "horizontal"} layout`}
          size="sm"
          iconColor="secondary"
          onClick={() =>
            setWorkspaceLayout((prev) => (prev === "horizontal" ? "vertical" : "horizontal"))
          }
        />
        <IconButton
          icon="search"
          title="Search or execute a command"
          size="sm"
          hotkeyAction="command_palette.toggle"
          iconColor="secondary"
          onClick={togglePalette}
        />
        <SettingsDropdown />
      </div>
    </div>
  );
});
